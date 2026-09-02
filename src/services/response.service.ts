import type { Wave } from "@prisma/client";

import { getCached, setCached } from "@/lib/cache";
import { EMPTY_SUMMARY, summarise, type Bucket, type Summary } from "@/lib/nps";
import { prisma } from "@/lib/prisma";
import { waveWindow } from "@/services/wave.service";

export type FeedbackRow = {
  id: string;
  score: number;
  verbatim: string | null;
  respondedAt: Date;
  customerName: string;
};

export type FeedbackPage = {
  rows: FeedbackRow[];
  total: number;
};

export type SortKey = "score" | "date";

export type ListFeedbackParams = {
  wave: Wave;
  bucket: Bucket;
  search: string;
  page: number;
  pageSize: number;
  sort: SortKey;
};

export type IncomingResponse = {
  brandSlug: string;
  from: string;
  waveLabel: string;
  score: number;
  text?: string | null;
  eventId: string;
};

function scoreFilter(bucket: Bucket) {
  switch (bucket) {
    case "promoters":
      return { gte: 9 };
    case "passives":
      return { gte: 7, lte: 8 };
    case "detractors":
      return { lte: 6 };
    default:
      return undefined;
  }
}

function scoreSql(bucket: Bucket): string {
  switch (bucket) {
    case "promoters":
      return "AND r.score >= 9";
    case "passives":
      return "AND r.score BETWEEN 7 AND 8";
    case "detractors":
      return "AND r.score <= 6";
    default:
      return "";
  }
}

export class ResponseService {
  /**
   * Every response in the wave that carries a written comment.
   */
  static async loadWaveFeedback(wave: Wave): Promise<FeedbackRow[]> {
    const { start, end } = waveWindow(wave);

    try {
      const rows = await prisma.response.findMany({
        where: {
          waveId: wave.id,
          verbatim: { not: null },
          respondedAt: { gte: start, lte: end },
        },
        include: { customer: { select: { name: true } } },
        orderBy: { respondedAt: "desc" },
      });

      return rows.map((row) => ({
        id: row.id,
        score: row.score,
        verbatim: row.verbatim,
        respondedAt: row.respondedAt,
        customerName: row.customer.name,
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Headline numbers for a wave, over the same responses the comments table
   * shows: the ones carrying a written comment. Bucket and search filters are
   * deliberately not applied, so the score card stays put while a reviewer
   * filters the table underneath it.
   */
  static async getSummary(wave: Wave): Promise<Summary> {
    const rows = await prisma.response.findMany({
      where: { waveId: wave.id, verbatim: { not: null } },
      select: { score: true },
    });

    if (rows.length === 0) return EMPTY_SUMMARY;

    return summarise(rows.map((row) => row.score));
  }

  static async listFeedback(params: ListFeedbackParams): Promise<FeedbackPage> {
    const { wave, bucket, search, page, pageSize, sort } = params;
    const { start, end } = waveWindow(wave);
    const offset = (page - 1) * pageSize;

    if (search.trim().length > 0) {
      const cacheKey = `${wave.id}|${bucket}|${sort}|${page}|${search}`;
      const cached = getCached<FeedbackPage>(cacheKey);
      if (cached) return cached;

      const where = `
        WHERE r."waveId" = '${wave.id}'
          AND r.verbatim IS NOT NULL
          AND r."respondedAt" >= '${start.toISOString()}'
          AND r."respondedAt" <= '${end.toISOString()}'
          AND r.verbatim ILIKE '%${search}%'
          ${scoreSql(bucket)}
      `;

      const rows = await prisma.$queryRawUnsafe<FeedbackRow[]>(`
        SELECT r.id, r.score, r.verbatim, r."respondedAt", c.name AS "customerName"
        FROM "Response" r
        JOIN "Customer" c ON c.id = r."customerId"
        ${where}
        ORDER BY ${sort === "score" ? "r.score DESC" : 'r."respondedAt" DESC'}, r.id ASC
        LIMIT ${pageSize} OFFSET ${offset}
      `);

      const counted = await prisma.$queryRawUnsafe<{ count: number }[]>(`
        SELECT COUNT(*)::int AS count
        FROM "Response" r
        JOIN "Customer" c ON c.id = r."customerId"
        ${where}
      `);

      const result: FeedbackPage = { rows, total: counted[0]?.count ?? 0 };
      setCached(cacheKey, result);
      return result;
    }

    const where = {
      waveId: wave.id,
      verbatim: { not: null },
      respondedAt: { gte: start, lte: end },
      score: scoreFilter(bucket),
    };

    const [rows, total] = await Promise.all([
      prisma.response.findMany({
        where,
        include: { customer: { select: { name: true } } },
        orderBy:
          sort === "score"
            ? [{ score: "desc" }, { id: "asc" }]
            : [{ respondedAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: pageSize,
      }),
      prisma.response.count({ where }),
    ]);

    return {
      rows: rows.map((row) => ({
        id: row.id,
        score: row.score,
        verbatim: row.verbatim,
        respondedAt: row.respondedAt,
        customerName: row.customer.name,
      })),
      total,
    };
  }

  /**
   * Persist one inbound provider event. Returns false when the payload could not
   * be matched to existing records. See docs/decisions.md.
   */
  static async record(event: IncomingResponse): Promise<boolean> {
    const brand = await prisma.brand.findUnique({ where: { slug: event.brandSlug } });
    if (!brand) {
      console.warn("[webhook] unknown brand", { slug: event.brandSlug, eventId: event.eventId });
      return false;
    }

    const customer = await prisma.customer.findUnique({
      where: { brandId_phone: { brandId: brand.id, phone: event.from } },
    });
    if (!customer) {
      console.warn("[webhook] unknown customer", { from: event.from, eventId: event.eventId });
      return false;
    }

    const wave = await prisma.wave.findUnique({
      where: { brandId_label: { brandId: brand.id, label: event.waveLabel } },
    });
    if (!wave) {
      console.warn("[webhook] unknown wave", { label: event.waveLabel, eventId: event.eventId });
      return false;
    }

    const alreadyRecorded = await prisma.response.findFirst({
      where: { eventId: event.eventId },
      select: { id: true },
    });

    if (alreadyRecorded) {
      console.info("[webhook] duplicate event ignored", { eventId: event.eventId });
      return false;
    }

    await prisma.response.create({
      data: {
        waveId: wave.id,
        customerId: customer.id,
        score: event.score,
        verbatim: event.text?.trim() ? event.text.trim() : null,
        eventId: event.eventId,
        respondedAt: new Date(),
      },
    });

    return true;
  }
}
