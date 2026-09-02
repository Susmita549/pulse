import { notFound } from "next/navigation";

import { AddCustomerForm } from "@/components/AddCustomerForm";
import { BucketFilter } from "@/components/BucketFilter";
import { FeedbackTable } from "@/components/FeedbackTable";
import { Pagination } from "@/components/Pagination";
import { ScoreCard } from "@/components/ScoreCard";
import { SearchBox } from "@/components/SearchBox";
import { FlaggedFilter } from "@/components/FlaggedFilter";
import { WaveSelect } from "@/components/WaveSelect";
import { formatDate } from "@/lib/format";
import { isBucket } from "@/lib/nps";
import { BrandService } from "@/services/brand.service";
import { ResponseService, type SortKey } from "@/services/response.service";
import { WaveService } from "@/services/wave.service";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

type SearchParams = Record<string, string | string[] | undefined>;

function readParam(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

export default async function BrandDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const query = await searchParams;

  const brand = await BrandService.getBySlug(slug);
  if (!brand) notFound();

  const waves = await WaveService.listForBrand(brand.id);

  if (waves.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center text-slate-600">
        {brand.name} has no waves yet.
      </div>
    );
  }

  const requestedWaveId = readParam(query, "wave");
  const wave = waves.find((candidate) => candidate.id === requestedWaveId) ?? waves[0];

  const bucketParam = readParam(query, "bucket");
  const bucket = isBucket(bucketParam) ? bucketParam : "all";
  const search = readParam(query, "q") ?? "";
  const sort: SortKey = readParam(query, "sort") === "date" ? "date" : "score";
  const page = Math.max(1, Number.parseInt(readParam(query, "page") ?? "1", 10) || 1);
  const flaggedOnly = readParam(query, "flagged") === "1";

  const summary = await ResponseService.getSummary(wave);
  const { rows, total } = await ResponseService.listFeedback({
    wave,
    bucket,
    search,
    page,
    pageSize: PAGE_SIZE,
    sort,
    flaggedOnly,
  });

  const linkQuery: Record<string, string> = { wave: wave.id, bucket, q: search };
  if (flaggedOnly) linkQuery.flagged = "1";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{brand.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {wave.label} · {formatDate(wave.startDate)} – {formatDate(wave.endDate)}
          </p>
        </div>

        <WaveSelect
          waves={waves.map((option) => ({ id: option.id, label: option.label }))}
          currentId={wave.id}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ScoreCard summary={summary} />
        </div>
        <AddCustomerForm brandId={brand.id} brandSlug={brand.slug} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <BucketFilter current={bucket} />
          <FlaggedFilter current={flaggedOnly} />
        </div>
        <SearchBox current={search} />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <FeedbackTable rows={rows} sort={sort} query={linkQuery} brandSlug={brand.slug} />
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} />
      </div>
    </div>
  );
}
