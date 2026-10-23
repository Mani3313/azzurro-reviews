# Guest Review Pulse: Booking.com review insights for Azzurro Hotels

A small application that collects public Booking.com guest reviews for four Azzurro Hotels properties in Sydney and turns them into a dashboard that operations staff can read at a glance. It answers three questions:

1. **How are we doing this week?** The average rating this week compared with last week, overall and per property.
2. **What is going wrong, and is it getting worse?** Recurring operational topics (cleanliness, check-in, noise and so on) with trends, plus urgent issues (pests, safety) flagged every time they appear.
3. **What exactly did guests say?** A filterable review feed, so every number can be traced back to the reviews behind it.

| Property | Booking.com page |
|---|---|
| Olympic Hotel Paddington | [olympic-paddington](https://www.booking.com/hotel/au/olympic-paddington.html) |
| Potts Point | [venus-potts-point-sydney](https://www.booking.com/hotel/au/venus-potts-point-sydney.html) |
| Central Sydney | [venus-surry-hills](https://www.booking.com/hotel/au/venus-surry-hills.html) |
| Darling Harbour | [chateau-de-venus](https://www.booking.com/hotel/au/chateau-de-venus.html) |

---

## Quick start (about 5 minutes)

Requirements: **Node.js 20+** and **MongoDB** (Docker or a local install).

```bash
npm install
cp .env.example .env.local        # defaults work with the Docker MongoDB below
docker compose up -d              # starts MongoDB on localhost:27017 (skip if you already run MongoDB)
npm run seed                      # loads the bundled sample: 1,283 real reviews
npm run dev                       # http://localhost:3000
```

To collect live reviews:

```bash
npm run setup:browser             # one-off: downloads Playwright's Chromium
npm run scrape                    # incremental: fetches only what's new
```

Other commands:

| Command | What it does |
|---|---|
| `npm run scrape` | Incremental collection for all four properties. Stops at each property once it reaches reviews it already has. |
| `npm run scrape:full` | Re-reads every page (backfill). Darling Harbour has about 430 pages, so this takes a while. |
| `npm run scrape -- --property=olympic-paddington --max-pages=3 --headed` | Collect one property, cap the pages, and show the browser (useful for diagnosing problems). |
| `npm run scrape -- --save-raw` | Also writes the raw cards to `data/raw/<slug>-<date>.json` (names hashed). |
| `npm run import -- file.json …` | Imports raw JSON snapshots through the same validation and dedupe as the scraper. |
| `npm run classify [-- --force \| --llm]` | Re-tags topics after rule changes, or with Claude if `ANTHROPIC_API_KEY` is set. |
| `npm run eval [-- --verbose \| --set=gold \| --llm]` | Measures topic tagging against the hand-labelled review sets. |
| `npm test` | Unit tests, plus an end-to-end collector test against a local fixture page (skipped if Chromium isn't installed). |
| `npm run build && npm start` | Production build of the dashboard. |

To keep it current, schedule `npm run scrape` once or twice a day (cron, launchd, or a GitHub Actions or Render cron job). A non-zero exit code means a property failed, so the scheduler can alert on it.

---

## Architecture

```
                 ┌──────────────── collection (Node CLI) ────────────────┐
Booking.com ───▶ │ scraper/collect.js   Playwright: open reviews, sort    │
 (public pages)  │                       newest, paginate, expand replies │
                 │ scraper/extract.js    in-page DOM extractor            │
                 │        │              (data-testid selectors only)     │
manual fallback  │        ▼                                               │
 browser JSON ─▶ │ scraper/import.js ─▶ scraper/ingest.js                 │
                 │                      lib/normalize.js   validate,      │
                 │                         parse, fingerprint, hash names │
                 │                      lib/topics/*       tag topics     │
                 │                      scraper/store.js   idempotent     │
                 │                         upsert + run log               │
                 └──────────────────────────┬─────────────────────────────┘
                                            ▼
                                ┌───────── MongoDB ──────────┐
                                │ reviews      (_id = fingerprint)
                                │ properties   (Booking score, last success)
                                │ scrape_runs  (one per property per run)
                                └──────────────┬─────────────┘
                                               ▼
                 ┌──────────── dashboard (Next.js App Router) ────────────┐
                 │ lib/queries.js   reads + URL filter parsing            │
                 │ lib/analytics.js pure functions: weeks, trends, topic  │
                 │                  stats, plain-English insights         │
                 │ app/             Overview · Reviews · Data health ·    │
                 │                  How it works (server components)      │
                 └────────────────────────────────────────────────────────┘
```

- **One validation gate.** The scraper and the importer both go through `lib/normalize.js`, so every stored review follows the same rules wherever it came from.
- **Analytics are pure functions** (`lib/analytics.js`) over plain arrays, which makes them unit-testable without a database. The data volume is small (a few thousand reviews a year), so one indexed query followed by computation in Node is simpler than aggregation pipelines and fast enough.
- **Server-rendered pages, filters in the URL.** Every view is a shareable link (`/reviews?property=chateau-de-venus&complaint=pests`). The filter forms still work without JavaScript. Only the charts are client components.

### Project layout

```
config/properties.js      the four properties (slug, display name, URL)
scraper/                  collection CLIs: run, import, classify, evaluate; browser-collector.js fallback
lib/                      normalisation, dates, language, topics, analytics, queries, db
app/                      Next.js pages
components/               filter bar, charts, small UI pieces
data/raw/                 sample review data (JSON, reviewer names hashed)
data/eval/                hand-labelled topic sets and accuracy reports
tests/                    node:test unit tests, fixture page, collector end-to-end test
```

---

## How reviews are collected

### Why a real browser

Booking.com gives no API access. The property page renders reviews client-side from an internal GraphQL endpoint, behind AWS WAF bot protection. The older `reviewlist.html` endpoint that many tutorials use now returns "Page not found" (checked during development). There were three options:

| Option | Verdict |
|---|---|
| Call the internal GraphQL API directly | Rejected. It needs reverse-engineered queries and replayed WAF tokens. It is brittle, and it is the kind of evasion we shouldn't build. |
| Fetch HTML with plain HTTP and parse it | Rejected. Reviews aren't in the initial HTML. |
| **Load the public page in a headless browser, as a guest would** | **Chosen.** Reads exactly what any visitor sees, using Playwright. |

### The flow (`scraper/collect.js`)

1. Open the English (en-gb) listing, so dates and scores parse predictably.
2. Decline non-essential cookies if a banner appears.
3. Detect a bot check (captcha or "access denied") and **stop with status `blocked`**. We do not try to get around it.
4. Click "Read all reviews", sort by **Newest first**, and read 10 cards per page.
5. Expand truncated hotel replies ("Continue reading") before reading.
6. Save each page as soon as it is read, so a failure on page 30 keeps pages 1–29.
7. Click "Next page" and wait until the cards actually change, rather than sleeping for a fixed time.

### Selectors that survive redesigns

Booking.com's CSS class names are hashed and change with every deploy. The extractor (`scraper/extract.js`) uses **only `data-testid` attributes** (`review-card`, `review-score`, `review-positive-text`, `review-negative-text`, `review-date`, `review-stay-date` and so on), which are test hooks and much more stable. It also guards against small markup changes, for example by reading the score from the element whose own text is just the number.

### Reliability and data quality controls

| Risk | Control |
|---|---|
| Duplicate reviews | No review id is exposed, so `_id` is a **SHA-256 fingerprint** of the fields that never change after publication (property, date, score, title, liked/disliked text, stay details, hashed reviewer name). Upserts are idempotent: importing the sample twice gives 1,283 new reviews, then 0. In-page duplicates caused by pagination shifting are dropped too (3 found in the sample). |
| Missing new reviews | Incremental runs sort newest-first and stop only after **2 consecutive pages** with nothing new. A review published mid-run shifts pages by one card, and the second page absorbs that. |
| Temporary failures | Navigation and pagination are retried with exponential backoff (1s, 2s, 4s). Each property is collected independently, so one failure doesn't stop the others. Every run is logged to `scrape_runs` with pages, new, rejected, warnings and errors, and the exit code is non-zero on failure. |
| Page layout changes | Health check: if more than half the cards on a page lack a score or date, the run aborts with `LAYOUT_CHANGED` and saves an HTML and screenshot snapshot to `data/debug/`. The dashboard then shows stale data with a warning, rather than wrong data. |
| Bad values | `normalize.js` rejects unparseable scores and dates, scores outside 1–10, future dates and unknown properties. Rejections are counted per run. Booking's "There are no comments available" placeholder is treated as no text. |
| Hotel replies | The list view truncates replies. The collector expands them, and a truncated reply never overwrites a full one that is already stored. |
| Edited reviews | An edited review gets a new fingerprint. A new review that matches an older one on every stay detail is **flagged** (`possibleDuplicateOf`), not merged, because Booking only shows first names and genuine repeat guests look the same. The count appears on the Data health page. |
| Politeness | 1.2–2.5s randomised delay between pages and 5–10s between properties. An incremental run reads about 2–3 pages per property. |
| Privacy | Reviewer names are hashed (one-way) and never stored, and the sample files contain no names. Country, traveller type and room are kept because they are useful operationally. |

### Manual fallback: browser-assisted collection

`scraper/browser-collector.js` is the same extractor packaged as a DevTools snippet. A person opens a property page in their normal browser, pastes it, and gets a JSON file to `npm run import`. **The bundled sample data was collected this way**, because the development sandbox's network could not reach Booking.com. It goes through exactly the same validation and dedupe as the automated scraper.

### Testing status

- Extractor: verified against the live Booking.com pages (October 2026), all fields.
- Collector flow (open, sort, paginate, expand replies, early stop): covered by `tests/collect.e2e.test.js` against a local fixture that mimics Booking's markup.
- Full automated runs against live Booking.com: run `npm run scrape -- --max-pages=2` on your own machine to confirm. Headless Chromium may be shown a bot check from some networks. If so, the run reports `blocked` (see Limitations).

---

## How insights are produced

### Definitions (also on the in-app "How it works" page)

- **Rating**: the guest's Booking.com score, 1–10.
- **Positive / neutral / negative**: 8 or above / 6–7 / 5 or below, following Booking's own bands ("Very good" and up, versus "Passable" and below).
- **Week**: Monday to Sunday, Sydney time, by the date the **review was published** (not the stay date). "This week" is week-to-date, up to the data's as-of date, which is the date of the last successful collection. So the sample data stays meaningful even when opened weeks later.
- **Low sample**: any week with fewer than 5 reviews is marked "few". Insight sentences always state their counts, and with fewer than 5 negative reviews they give counts ("1 of the 2 negative reviews…") instead of percentages.

### Topic tagging methodology

Booking asks every guest two separate questions: "What did you like?" and "What didn't you like?". **That split gives polarity for free**: a topic found in the disliked answer is a complaint, and one found in the liked answer is praise. The classifier only has to decide which topics a text mentions, which keyword rules do reasonably well. It does not have to judge whether a sentence is positive, which keyword rules do badly.

Topics: the eight requested (Cleanliness, Check-in & access, Staff & service, Noise, Facilities & amenities, Location, Room condition & comfort, Value for money), plus two the data showed were needed and urgent: **Pests** (cockroaches appeared repeatedly) and **Safety & security** (theft, drugs, feeling unsafe). Urgent topics are surfaced every time they appear, even once.

Rules (`lib/topics/taxonomy.js` and `keyword.js`):

- **Strong and weak terms, matched per clause.** Generic nouns ("bathroom", "room") only count when nothing stronger matched in the same clause. "The bathroom was dirty" is cleanliness, not facilities.
- **Non-answers.** Disliked answers such as "Nothing, everything was great!" are not complaints. Liked answers such as "Nothing, filthiest place ever" are not praise.
- **Rating-only reviews** (about 47%) can't be tagged. If the guest wrote only a title ("Dirty bathrooms, no lift"), the title is used, with polarity taken from the score.
- **Languages.** About a third of reviews with text aren't in English (French, Spanish, German and Chinese are the most common). There are word lists for about 15 languages (Chinese, Japanese, Korean, Russian, Spanish, French, German, Italian, Dutch, Portuguese, Polish, Scandinavian languages and Hebrew). English text never triggers the foreign lists, so Spanish "caro" never matches English "carousel".
- **Explainable.** Each tag stores the words that triggered it. Hovering a tag in the review feed shows them.

### Accuracy (measured, not assumed)

Two hand-labelled sets of real reviews are in `data/eval/`. The rules were tuned on the first (70 reviews). The second (45 reviews) was labelled afterwards and **never used for tuning**, so it is the honest estimate. Run `npm run eval`.

| Held-out set (45 reviews) | Precision | Recall | F1 |
|---|---|---|---|
| Complaints | 72% | 88% | 79% |
| Praise | 93% | 89% | 91% |

The tuning set scores 86% and 94% F1, which shows the expected optimism of measuring on data you tuned against. Strongest topics: cleanliness, noise, facilities, check-in and pests. Weakest: room condition, value and location, where incidental words ("my bed was given to someone else", "by far the worst") trigger false complaints. The dashboard therefore tells users to read the reviews behind a number, and every number links to them. Caveat: one developer labelled both sets; a second annotator would make the numbers more trustworthy.

### Optional: Claude classifier

`npm run classify -- --llm` re-tags reviews with Claude (needs `ANTHROPIC_API_KEY`; the model is set by `LLM_MODEL`). The output contract is identical to the keyword rules, and the model can only choose from the fixed topic ids (anything else is dropped). Batches are validated, retried once, then fall back to the keyword rules. Results are cached by classifier version, so only stale reviews are re-sent. `npm run eval -- --llm` compares it on the same held-out set. It should do better on paraphrase, sarcasm and unsupported languages. It is optional because it adds cost, a network dependency and harder auditing. *This path was not run during development (no API key in the sandbox); its parsing and validation are unit-tested.*

---

## The dashboard

- **Overview**: a one-sentence headline ("Guests rated us 5.5 out of 10 this week, up 0.5 on last week's 5.0"); a **What needs attention** list of plain-English insights such as "77% of negative reviews over the last two weeks mentioned cleanliness issues (10 of 13 negative reviews with comments)", each linking to the matching reviews; a property-by-property table (this week, last week, change, period average, negative share, top complaint, Booking's all-time score); weekly rating and positive/negative trend charts, each with a table view; and a topic table with complaint and praise counts, change against the previous period, and share of negative reviews.
- **Reviews**: a feed with property and period filters plus rating, topic (complaint or praise), comments or rating-only, replied or not, free-text search and sort. Each card shows the stay details, liked and disliked text, topic tags, language and the hotel's reply. Negative reviews without a reply are highlighted.
- **Data health**: last run per property, status, new reviews, coverage against Booking's total, date range stored, warnings, data quality counters and a run history. This is where ops staff check whether a number can be trusted.
- **How it works**: definitions and limitations in plain language.

Design choices for non-technical users: plain sentences before charts; sample sizes shown next to every average; a fixed colour per property that doesn't change with filters; status always shown as icon plus text, never colour alone; charts with a table view; working in dark mode, on mobile and from the keyboard.

---

## Sample data

`data/raw/*.json`: **1,286 review cards (1,283 unique)** collected on 23 October 2026.

| Property | Stored | Booking total | Range |
|---|---|---|---|
| Olympic Hotel Paddington | 85 | 85 | 6 Jul – 23 Oct 2026 (complete) |
| Potts Point | 399 | 2,444 | 31 Jul 2025 – 20 Oct 2026 |
| Central Sydney | 400 | 2,480 | 28 Jun 2025 – 23 Oct 2026 |
| Darling Harbour | 399 | 4,333 | 11 Jan – 21 Oct 2026 |

The latest 400 per property is plenty for weekly operations. `npm run scrape:full` backfills the rest.

---

## Known limitations and assumptions

- **Terms of service.** Booking.com's terms restrict automated collection. This tool reads a low volume of public data, only for internal analysis of Azzurro's own properties, at a polite rate, and does not bypass bot protection. For production I would move to a licensed source: Booking.com's Connectivity/partner review data if Azzurro has partner access, or a review aggregator (ReviewPro, TrustYou, Revinate). The rest of the pipeline is unchanged by that switch: only `collect.js` would be replaced.
- **Bot protection.** Headless browsers can be challenged. The collector detects this and stops. `--headed` or running from a normal office network usually helps. If challenges persist, that is the signal to switch to a licensed source, not to add evasion.
- **English UI assumed.** Dates and scores are parsed from the en-gb page. A non-English page is rejected, not misread.
- **"Week" uses the review's publish date**, not the stay date. Guests can review days or weeks after checkout, so the reviews about a bad week of stays arrive gradually.
- **Booking.com shows first names only**, so the reviewer hash is not a unique guest id.
- **Topic tags are approximate** (see the accuracy table). Use them to decide which reviews to read, not as KPIs on their own.
- **Booking-only.** Google, Expedia and TripAdvisor reviews are not included.

## If this went to production

1. Schedule the collector (hourly is unnecessary; twice daily is plenty) and send an alert when a run is `failed`, `blocked` or `LAYOUT_CHANGED`.
2. Add sign-in (for example Azure AD or Google Workspace SSO) before hosting the dashboard.
3. Evaluate the LLM classifier on the held-out set and switch if it is clearly better. Add a "wrong tag?" button so staff corrections grow the labelled set.
4. Track reply rate and reply time as KPIs (the data is already stored).
5. Above roughly 100k reviews, move the analytics into MongoDB aggregation pipelines and pre-aggregate weekly stats.
