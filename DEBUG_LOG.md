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

PULSE-105 looked like one ticket. It was two defects sitting behind it. D6 is why the test script said it stored nothing. D7 is why a redelivery stored copies. Fixing either one alone would leave the other symptom.

### D6: Webhook returned before the writes finished (PULSE-105)

**Symptom:** `npm run send:responses` reported storing none of what it sent. The rows showed up if you looked again a moment later.

**How I found it:** Read `POST /api/webhooks/mock-whatsapp` next to `scripts/send-responses.ts`, which counts rows as soon as the HTTP response comes back.

**Root cause:** `events.forEach(async (event) => { await ResponseService.record(event); })` does not wait. `forEach` ignores the promises. The handler returned 200 while inserts were still in flight.

**Fix:** `await Promise.all(events.map((event) => ResponseService.record(event)))` so the 200 means the batch has actually been written. Still return 2xx for unmatched payloads — that is on purpose (`docs/decisions.md`). A bad brand slug is not transient; 4xx would make the provider retry a dead payload for hours.

**How I verified it:** After this, `send:responses` reports `stored 5 of 5` at +0ms for unique event ids.

**Blast radius:** Only this route. Duplicate `eventId` under concurrent writes is D7, not this.

### D7: Redelivered events stored more than once (PULSE-105)

**Symptom:** The provider redelivered a batch and we ended up with several copies of the same answer. `send:responses --duplicate` is the repro.

**How I found it:** Read `ResponseService.record`. `eventId` is documented as a de-duplication key but had no unique constraint — only a `findFirst` before `create`.

**Root cause:** Check-then-insert is racy. Two in-flight deliveries both see “not found” and both insert. The database had nothing to reject the second row. Postgres unique indexes treat `NULL` as distinct, so in-app rows with no `eventId` can still coexist.

**Fix:** `eventId String? @unique`. Insert and catch Prisma `P2002` as a duplicate, same pattern as `addCustomer`. Webhook still returns 2xx. Needs `npx prisma db push` so the index exists.

**How I verified it:** `send:responses --duplicate` stores 1 of 5 and one distinct event id. A normal run still stores all five distinct ids.

**Blast radius:** Only webhook inserts. Seeded responses have null `eventId`. Dirty data with duplicate event ids would block `db push`; `db:reset` clears that.

PULSE-106 also had two things behind the empty dashboard. D8 is the timezone bug that empties Flash Feb. D9 is the extra date filter that can hide rows that already belong to the wave by `waveId`.

### D8: Wave window used local midnight (PULSE-106)

**Symptom:** The dashboard said no feedback for a wave that had responses — Acme “Flash Feb 2026”.

**How I found it:** Seed stores that wave as one UTC day with responses between 19:00 and 23:00 UTC. The comments table (and originally the summary) clipped to `waveWindow()`. I ran both window calculations under IST: local end-of-day cuts off at 18:29 UTC, so every Flash Feb row falls outside.

**Root cause:** `startDate` / `endDate` are UTC calendar dates. `setHours` applies the machine timezone. In IST the window becomes `Feb 9 18:30Z → Feb 10 18:29Z`. Evening-UTC replies never match. Empty summary used to render “No feedback yet”; after D1 the score card reads by `waveId` only, but the table was still empty for the same reason.

**Fix:** `setUTCHours(0, 0, 0, 0)` and `setUTCHours(23, 59, 59, 999)` so the window is the UTC day the seed and `@db.Date` describe.

**How I verified it:** SQL: 0 rows inside the old IST window, 300 inside the UTC day (179 with comments). After the change, Flash Feb shows the score card and 179 comments.

**Blast radius:** `waveWindow` is still used by unused `loadWaveFeedback`. Live reads are covered by D9 as well.

### D9: Reads also filtered by respondedAt (PULSE-106)

**Symptom:** Same family of bug — feedback exists on the wave, but the UI can still miss it. Clearest with webhook rows: stored against the right `waveId`, stamped `respondedAt: new Date()`, then filtered out because “today” is outside the wave’s calendar range.

**How I found it:** While checking Flash Feb / webhook verification. Q1 2026 had more rows in the database than the dashboard showed; the gap was the events just sent.

**Root cause:** Membership was defined twice. The foreign key `waveId` already says which wave a response belongs to. Clipping again on `respondedAt` can only remove rows that genuinely belong to the wave.

**Fix:** Dropped the `respondedAt` window from `listFeedback` (search and non-search). `getSummary` already keyed off `waveId` after D1. I did not rewrite `respondedAt` on write — the received time is a fact about the delivery.

**How I verified it:** Flash Feb still shows 179. Webhook events for Q1 show up in the dashboard total without waiting for a date inside Jan–Mar.

**Blast radius:** Only the feedback list path. `loadWaveFeedback` still applies the (now UTC) window, but nothing calls it.

### D10: Comment search built SQL by concatenating the query (no ticket)

**Symptom:** Nobody filed this. Search comments with an apostrophe and the query can blow up or change meaning. Happy-path searches like “delivery” work, so it sat unnoticed.

**How I found it:** Read the search branch of `listFeedback`. It used `$queryRawUnsafe` and dropped `search` straight into `ILIKE '%${search}%'`. I ran the old shape in psql: `ILIKE '%'%'` fails with `unterminated quoted string`.

**Root cause:** Two query implementations. The search path built SQL by string concatenation instead of bound parameters. There was also a 60s in-process cache on that path with no invalidation when webhook rows landed. That is a weaker cousin of the same “search is a special case” split; it goes away when the raw path goes away.

**Fix:** One Prisma `findMany` / `count` path. Non-empty search uses `verbatim: { contains: trimmed, mode: "insensitive" }` (Postgres `ILIKE`, parameterized). Removed the cache use from this path.

**How I verified it:** `?q=delivery` returns 8 rows, matching SQL. `?q='` returns 200, not an error. `?q=%' OR '1'='1` shows “No comments match these filters” — treated as literal text, not SQL.

**Blast radius:** Only `listFeedback`. `src/lib/cache.ts` is now unused; I left the file. `%` in a search string is still an ILIKE wildcard, same as before.

## Looks wrong but I left it alone

- **Webhook still returns 2xx** for unknown brand / customer / wave. `docs/decisions.md` is explicit: a bad slug is not transient, and 4xx/5xx makes the provider retry a dead payload for hours. `received: N` means we accepted N events, not that we stored N rows.
- **Buckets are derived at read time**, not stored. Documented. Boundaries have moved before.
- **Score-only rows stay out of the comments table.** That is the table's job. D1 made the headline match that set on purpose.
- **`db push` instead of migrations.** Documented for a disposable database.

## Suspected, not fixed

### S1: Bucket highlight can lie after back/forward

`BucketFilter` and `SearchBox` keep `useState(current)` and never sync when `current` changes from the URL. After D4 the click path writes the right query param, so the table is correct. Browser back/forward still updates the URL (and the table) without resetting that local state, so the dark button or the search box can disagree with what you are looking at.

I could not drive back/forward with `curl`. I did not want to “fix” it in D4 because that is not the one-click lag in the ticket. I think it is real. I have not watched it in a browser.

### S2: `?page=999` looks like “no comments”

I did reproduce this. Flash Feb has 179 comments, 12 pages. `?page=999` still 200s. The table says “No comments match these filters.” The footer says `14971–179 of 179` and `Page 999 of 12`. Previous is enabled, Next is disabled. The score card is still −49 from 179, so it is not an empty wave.

`skip`/`take` just walk off the end of the result set. Pagination never clamps `page`. I left it — it is ugly, not the “no feedback yet” ticket, and the Next button already stops you getting here from the UI. A pasted URL is the only way I hit it.

### S3: Dead `loadWaveFeedback` swallows every error

It still `catch`es and returns `[]`. If anything called it during a database outage, you would get the empty-wave UI. Nothing calls it after D1, so I could not reproduce it on a live page. If it is ever wired back up, that `catch` should go.







