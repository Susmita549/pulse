# DEBUG_LOG

Ran the app locally (`npm run dev`, Postgres in Docker, seeded data). I used `psql` to check counts against the UI. Timezone here is IST.

### D1: Headline NPS counted more rows than the table (PULSE-101)

**Symptom:** The number on the score card doesn't match what you get if you count the rows yourself. It's close, just not the same.

**How I found it:** I read `getSummary` and then actually counted. On Acme's Flash Feb 2026 wave the card said 300 responses and the comments table said 179. The seed skips a comment on about a third of responses, so 121 people in that wave left a score and nothing else. That was the gap.

**Root cause:** The two parts of the page were answering different questions. `getSummary` counted every response in the wave. `listFeedback` only listed ones with a comment. So if you sat there and counted the rows, you'd never land on the headline number.

**Fix:** I made `getSummary` use the same filter as the table: only rows with a comment. I didn't apply the bucket or search filters to it, so the score card stays put while you click around the table. I'll be honest: this is a judgement call. The README says NPS is over all 0–10 scores, which would mean keeping the 300 and living with the table being smaller. We decided the headline should describe the feedback you can actually read. If that's the wrong call, it's one `where` clause.

**How I verified it:** I checked every wave in SQL (`verbatim IS NOT NULL`) against the card and the table. They now match: Flash Feb 179, Acme Q1 417, Q3 401, Q4 382, Northwind Q1 391, Q3 383, Q4 352. Before this they disagreed on every wave. The breakdown also lines up — Flash Feb is 30 / 32 / 117, and clicking Detractors shows 117 rows.

**Blast radius:** `/brands` uses the same `getSummary`, so those headlines moved too and still match SQL. I looked for other places that load wave responses. `loadWaveFeedback` does, but nothing calls it any more.
