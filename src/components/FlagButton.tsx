"use client";

import { useState, useTransition } from "react";

import { setResponseFlag } from "@/actions/responses";
import { cx } from "@/lib/format";

export function FlagButton({
  id,
  flagged,
  brandSlug,
}: {
  id: string;
  flagged: boolean;
  brandSlug: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onToggle = () => {
    setError(null);
    startTransition(async () => {
      const result = await setResponseFlag({ id, brandSlug, flagged: !flagged });
      if (!result.success) {
        setError(result.error.message);
      }
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-pressed={flagged}
        className={cx(
          "rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-50",
          flagged
            ? "border-slate-900 bg-slate-900 text-white"
            : "border-slate-200 text-slate-600 hover:bg-slate-100",
        )}
      >
        {pending ? "Saving…" : flagged ? "Flagged" : "Flag"}
      </button>
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}
