import Link from "next/link";

import { FlagButton } from "@/components/FlagButton";
import { formatDateTime, cx } from "@/lib/format";
import { bucketForScore } from "@/lib/nps";
import type { FeedbackRow, SortKey } from "@/services/response.service";

const TONE: Record<string, string> = {
  promoter: "bg-emerald-50 text-emerald-700",
  passive: "bg-amber-50 text-amber-700",
  detractor: "bg-rose-50 text-rose-700",
};

function SortLink({
  label,
  sortKey,
  currentSort,
  query,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  query: Record<string, string>;
}) {
  const params = new URLSearchParams({ ...query, sort: sortKey, page: "1" });

  return (
    <Link
      href={`?${params.toString()}`}
      className={cx(
        "hover:text-slate-900",
        currentSort === sortKey ? "text-slate-900 underline" : "text-slate-500",
      )}
    >
      {label}
    </Link>
  );
}

export function FeedbackTable({
  rows,
  sort,
  query,
  brandSlug,
}: {
  rows: FeedbackRow[];
  sort: SortKey;
  query: Record<string, string>;
  brandSlug: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-slate-500">
        No comments match these filters.
      </div>
    );
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="px-4 py-3 font-medium">Customer</th>
          <th className="px-4 py-3 font-medium">
            <SortLink label="Score" sortKey="score" currentSort={sort} query={query} />
          </th>
          <th className="px-4 py-3 font-medium">Comment</th>
          <th className="px-4 py-3 font-medium">
            <SortLink label="Received" sortKey="date" currentSort={sort} query={query} />
          </th>
          <th className="px-4 py-3 font-medium">Follow-up</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const bucket = bucketForScore(row.score);

          return (
            <tr key={row.id} className="border-b border-slate-50 last:border-0 align-top">
              <td className="px-4 py-3 whitespace-nowrap text-slate-700">{row.customerName}</td>
              <td className="px-4 py-3">
                <span
                  className={cx(
                    "inline-flex h-6 w-6 items-center justify-center rounded text-xs font-semibold tabular-nums",
                    TONE[bucket],
                  )}
                >
                  {row.score}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-700">{row.verbatim}</td>
              <td className="px-4 py-3 whitespace-nowrap text-slate-500">
                {formatDateTime(row.respondedAt)}
              </td>
              <td className="px-4 py-3">
                <FlagButton id={row.id} flagged={row.flagged} brandSlug={brandSlug} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
