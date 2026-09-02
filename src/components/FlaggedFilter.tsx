"use client";

import { useRouter, useSearchParams } from "next/navigation";

import { cx } from "@/lib/format";

export function FlaggedFilter({ current }: { current: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const onToggle = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (current) {
      params.delete("flagged");
    } else {
      params.set("flagged", "1");
    }
    params.set("page", "1");
    router.push(`?${params.toString()}`);
  };

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={current}
      className={cx(
        "rounded-md border px-3 py-1.5 text-sm",
        current
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100",
      )}
    >
      Flagged only
    </button>
  );
}
