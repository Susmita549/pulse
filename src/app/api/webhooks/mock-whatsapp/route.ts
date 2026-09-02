import { NextResponse } from "next/server";
import { z } from "zod";

import { ResponseService } from "@/services/response.service";

export const dynamic = "force-dynamic";

const EventPayload = z.object({
  brandSlug: z.string().min(1),
  from: z.string().min(1),
  waveLabel: z.string().min(1),
  score: z.number().int().min(0).max(10),
  text: z.string().nullish(),
  eventId: z.string().min(1),
});

// Providers batch events, so accept either a single event or an array of them.
const Body = z.union([EventPayload, z.array(EventPayload)]);

export async function POST(request: Request) {
  let json: unknown;

  try {
    json = await request.json();
  } catch {
    console.warn("[webhook] body was not valid JSON");
    return NextResponse.json({ ok: true, ignored: "unparseable" });
  }

  const parsed = Body.safeParse(json);

  if (!parsed.success) {
    console.warn("[webhook] payload failed validation", {
      issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
    return NextResponse.json({ ok: true, ignored: "invalid" });
  }

  const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  await Promise.all(events.map((event) => ResponseService.record(event)));

  return NextResponse.json({ ok: true, received: events.length });
}
