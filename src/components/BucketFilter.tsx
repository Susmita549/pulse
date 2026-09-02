"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { BUCKETS, type Bucket } from "@/lib/nps";
import { cx } from "@/lib/format";

const LABELS: Record<Bucket, string> = {
  all: "All",
  promoters: "Promoters",
  passives: "Passives",
  detractors: "Detractors",
};

export function BucketFilter({ current }: { current: Bucket }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bucket, setBucket] = useState<Bucket>(current);

  const onSelect = (next: Bucket) => {
    setBucket(next);

    const params = new URLSearchParams(searchParams.toString());
    params.set("bucket", next);
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-1">
      {BUCKETS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onSelect(option)}
          className={cx(
            "rounded px-3 py-1.5 text-sm transition-colors",
            bucket === option ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
          )}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}
