export const BUCKETS = ["all", "promoters", "passives", "detractors"] as const;

export type Bucket = (typeof BUCKETS)[number];

export function isBucket(value: string | undefined): value is Bucket {
  return !!value && (BUCKETS as readonly string[]).includes(value);
}

export type BucketName = "promoter" | "passive" | "detractor";

/**
 * NPS bucket definition: 9-10 promoter, 7-8 passive, 0-6 detractor.
 */
export function bucketForScore(score: number): BucketName {
  if (score >= 9) return "promoter";
  if (score >= 7) return "passive";
  return "detractor";
}

export type Summary = {
  nps: number;
  promoters: number;
  passives: number;
  detractors: number;
  total: number;
};

export const EMPTY_SUMMARY: Summary = {
  nps: 0,
  promoters: 0,
  passives: 0,
  detractors: 0,
  total: 0,
};

/**
 * Net Promoter Score for a set of raw 0-10 scores.
 *
 *   NPS = %promoters - %detractors
 */
export function summarise(scores: number[]): Summary {
  const total = scores.length;
  if (total === 0) return EMPTY_SUMMARY;

  let promoters = 0;
  let passives = 0;
  let detractors = 0;

  for (const score of scores) {
    const bucket = bucketForScore(score);
    if (bucket === "promoter") promoters++;
    else if (bucket === "passive") passives++;
    else detractors++;
  }

  const promoterShare = (promoters / total) * 100;
  const detractorShare = (detractors / total) * 100;

  return {
    nps: Math.round(promoterShare - detractorShare),
    promoters,
    passives,
    detractors,
    total,
  };
}

export function percentage(count: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.round((count / total) * 100)}%`;
}
