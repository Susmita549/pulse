# DEBUG_LOG

Ran the app locally (`npm run dev`, Postgres in Docker, seeded data). I used `psql` to check counts against the UI. Timezone here is IST.

### D1: Headline NPS counted more rows than the table (PULSE-101)

**Symptom:** The number on the score card doesn't match what you get if you count the rows yourself. It's close, just not the same.

**How I found it:** I read `getSummary` and then actually counted. On Acme's Flash Feb 2026 wave the card said 300 responses and the comments table said 179. The seed skips a comment on about a third of responses, so 121 people in that wave left a score and nothing else. That was the gap.

**Root cause:** The two parts of the page were answering different questions. `getSummary` counted every response in the wave. `listFeedback` only listed ones with a comment. So if you sat there and counted the rows, you'd never land on the headline number.

**Fix:** I made `getSummary` use the same filter as the table: only rows with a comment. I didn't apply the bucket or search filters to it, so the score card stays put while you click around the table. I'll be honest: this is a judgement call. The README says NPS is over all 0–10 scores, which would mean keeping the 300 and living with the table being smaller. We decided the headline should describe the feedback you can actually read. If that's the wrong call, it's one `where` clause.

**How I verified it:** I checked every wave in SQL (`verbatim IS NOT NULL`) against the card and the table. They now match: Flash Feb 179, Acme Q1 417, Q3 401, Q4 382, Northwind Q1 391, Q3 383, Q4 352. Before this they disagreed on every wave. The breakdown also lines up — Flash Feb is 30 / 32 / 117, and clicking Detractors shows 117 rows.

**Blast radius:** `/brands` uses the same `getSummary`, so those headlines moved too and still match SQL. I looked for other places that load wave responses. `loadWaveFeedback` does, but nothing calls it any more.

### D2: Page 2 could show a row from page 1 (PULSE-102)

**Symptom:** Click Next on the comments table and you see someone you already saw on page 1.

**How I found it:** Read `listFeedback`. Default sort is score, page size 15. Scores only go 0–10, so a busy wave has a pile of 10s. I then walked eight pages in a small script: with `ORDER BY score DESC` only, 10 of the Flash Feb comment rows showed up twice.

**Root cause:** Pagination is `LIMIT` / `OFFSET`. If the sort key isn't unique, Postgres is free to shuffle tied rows between queries. The same id can land on page 1 this time and page 2 the next. Date sort has the same hole when two people reply in the same millisecond.

**Fix:** Added `id` as a tie-breaker, so the order is always `score DESC, id ASC` or `respondedAt DESC, id ASC`. Did it on both query paths — the Prisma `findMany` and the raw SQL search — because they paginate the same table.

**How I verified it:** Same eight-page walk after the change: 0 duplicates. On the live page, Flash Feb page 1 is fifteen 10s, page 2 is two 10s then 9s, and no customer names overlap.

**Blast radius:** Only `listFeedback`. I checked `loadWaveFeedback` — it sorts by date with no `id` either, but nothing paginates that list, so I left it.

### D3: NPS was chopped, not rounded (PULSE-101)

**Symptom:** After D1 the rows lined up, but the headline could still be one point off what you get on a calculator.

**How I found it:** Read `summarise` in `src/lib/nps.ts`. Flash Feb still didn't match.

**Root cause:** The code did `parseInt(String(promoterShare - detractorShare), 10)`. `parseInt` stops at the decimal, so it chops toward zero. −48.603 became −48. The subtraction itself was fine.

**Fix:** `Math.round(...)` instead. That's how NPS is usually shown, and it's what the README describes. The 17% / 18% / 65% labels already used `Math.round`, so I left those.

**How I verified it:** Flash Feb is 30 promoters and 117 detractors out of 179. That's 16.759% − 65.363% = −48.603, which rounds to −49. The old code showed −48. I also checked a positive wave (Acme Q4 → 51) and a more negative one (Northwind Q3 → −73).

If you subtract the labels on the card (17% − 65% = −48) you won't get −49. That's not a bug. Those percentages are rounded on their own. NPS rounds the real difference once.

**Blast radius:** This is the only place we compute NPS. The score card and the brands list both use it. I grepped for other `parseInt` calls; the page number parser is on a whole number, so it's fine.

### D4: Bucket filter wrote the previous click (PULSE-103)

**Symptom:** Filter by detractors and it still shows everyone. Click it again and it works. Click something else and it's wrong again.

**How I found it:** Read `BucketFilter.onSelect`. The ticket is exactly one click behind, which is what you get if you write React state into the URL right after `setState`.

**Root cause:** The handler did `setBucket(next)` then `params.set("bucket", bucket)`. `setBucket` doesn't update `bucket` until the next render, so the URL got the old value. The button highlight used local state, so it looked updated while the table followed the stale query param. Second click sent what you meant on the first. I checked the server filter too — `?bucket=detractors` really does return 0–6s (117 comments on Flash Feb). The query was fine. The click wasn't sending the right URL.

**Fix:** `params.set("bucket", next)` so the URL is the button you actually clicked.

I left the extra `useState`. After back/forward the highlight can still disagree with the URL, but the table follows the URL, so that is not this ticket. `WaveSelect` already writes the event value. `SearchBox` writes the typed input on submit, so it isn't the same bug.

**How I verified it:** With a correct URL, page 1 is all 10s / all 8s / all 6s for promoters / passives / detractors. The HEAD code wrote `bucket` (stale). After the change it writes `next`.

**Blast radius:** Only `BucketFilter`. Looked at the other client controls that push query params. Score card ignoring the bucket is on purpose from D1 — the headline stays put while you filter the table.

### D5: Brands page counted active customers one query at a time (PULSE-104)

**Symptom:** `/brands` was the slowest page — over a second with two brands. Two hundred brands would make it unusable.

**How I found it:** Read `BrandService.listWithStats`. The inner loop runs `prisma.response.count` once per customer. Seed puts 1,000 customers on each brand.

**Root cause:** ~2,000 sequential COUNT round-trips, plus a waves query and a summary per brand. The customer loop is what blows up. At 200 brands it becomes hundreds of thousands of queries.

**Fix:** Batch it. One waves query for all brand ids (pick latest in memory), `customer.groupBy` for totals, another `groupBy` with `responses: { some: {} }` for active customers, then `Promise.all` of `getSummary` for each latest wave. "Active" still means anyone who has ever responded.

I left one `getSummary` per brand. That looks expensive but it's one query per brand, not one per customer, and the page needs each headline.

**How I verified it:** Warm `/brands` is about 40–90 ms now. Acme shows 959 / 1000 and Northwind 933 / 1000, both matching SQL. NPS and response totals still match the comment-only summary from D1.

**Blast radius:** Only `listWithStats`. The brand detail page does not use this method.



