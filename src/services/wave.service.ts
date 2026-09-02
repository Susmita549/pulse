import type { Wave } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type WaveWindow = { start: Date; end: Date };

/**
 * The instant range a wave covers. `startDate`/`endDate` are stored as calendar
 * dates, so they need widening to cover the whole of the first and last day.
 */
export function waveWindow(wave: Pick<Wave, "startDate" | "endDate">): WaveWindow {
  const start = new Date(wave.startDate);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(wave.endDate);
  end.setUTCHours(23, 59, 59, 999);

  return { start, end };
}

export class WaveService {
  static async listForBrand(brandId: string): Promise<Wave[]> {
    return prisma.wave.findMany({
      where: { brandId },
      orderBy: { startDate: "desc" },
    });
  }

  static async getLatestForBrand(brandId: string): Promise<Wave | null> {
    return prisma.wave.findFirst({
      where: { brandId },
      orderBy: { startDate: "desc" },
    });
  }

  static async getById(waveId: string): Promise<Wave | null> {
    return prisma.wave.findUnique({ where: { id: waveId } });
  }

  static async getByLabel(brandId: string, label: string): Promise<Wave | null> {
    return prisma.wave.findUnique({
      where: { brandId_label: { brandId, label } },
    });
  }
}
