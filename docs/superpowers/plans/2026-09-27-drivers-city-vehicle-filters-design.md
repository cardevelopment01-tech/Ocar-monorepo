# Drivers page: City + Vehicle type filters (design plan)

Source proposal: https://sujalkrg.github.io/admin-driver-page/ (purple prototype, used as the interaction reference only).
Target: `apps/admin/app/(dashboard)/drivers/page.tsx`. Mode: OPERATE (admin task screen).
Theme: existing admin Tailwind tokens (teal `#0E8FA3`), per decision 7A. DESIGN.md is the reference.

## Goal
Let admins filter drivers by city and vehicle type, and read supply per city (drivers, active, pending). Rides/revenue/acceptance per city stay on the Analytics page (see NOT in scope).

## Decisions (each individually approved)
| # | Decision | Outcome |
|---|----------|---------|
| 1 | Filtered summary | Existing 4 stat cards become filter-scoped with server-side counts. Prototype "Status mix" bar dropped. |
| 2 | Unassigned city | City filter has a "Not assigned" option (API sentinel `city=none` => `d.city_id IS NULL`). |
| 3 | Load / error | First load: existing `SkeletonRows`. Filter change: old rows at 50% opacity. Failure: inline "Couldn't load drivers" + Retry; never show stale rows under new chips. |
| 4 | Empty result | Sentence names active filters ("No drivers in Angul with Luxury vehicles") + primary "Clear filters" button. |
| 5 | Filter state | Filters + search + page live in the URL (`useSearchParams`), so Back from a driver restores the view and links are shareable. |
| 6 | NEW badges | None. |
| 7 | Theme | Reuse admin Tailwind tokens: selected = `primary` text on `primary-light`, chips = `primary-light`/`primary`, `rounded-xl` like `FilterBar` search. No new tokens. |
| 8 | Control | Multi-select popover, applies instantly (debounced like search), one source of truth (URL). No Apply button. |
| 9 | Accessibility | Radix Popover (add `@radix-ui/react-popover`), checkbox roles, arrow-key nav, Esc returns focus, `aria-expanded`, "N selected" label, 44px targets. |
| 10 | Responsive | Below 1280: search full row, City/Vehicle/Status share next row; chips wrap; table scrolls sideways with Driver column pinned; popovers full-width below 640px. |
| 11 | Zero-count options | Kept, dimmed, with "0". Selected options never disappear. |

## Information architecture (top to bottom)
```
[Stat cards x4: Total | Active | Pending | Suspended]   <- scoped to current filters
[Pending-approval banner]                                 <- unchanged
[admin-card]
  [Search ............ ][City v][Vehicle type v][All Statuses v]
  [chip: City: Cuttack x][chip: Vehicle: Sedan x] Clear filters
  [Table: Driver | Code | Phone | Vehicle | City | Status | Docs | Joined | Review]
  [Showing 1-20 of N (filtered from total)   Previous  Next]
```
Kept from the live page (the prototype dropped them): Review button column, pending banner, full status list (`pending_approval`, `docs_rejected`, `suspended`, `pending_docs`, `active`).
New table column: City (map-pin icon + name; "Not assigned" in muted italic).

## Interaction states
| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Table | first load skeleton; later 50% dim | names filters + Clear filters | inline message + Retry | rows + count line | "filtered from N" in footer |
| Filter popover | list renders instantly from cached cities/categories | search finds none: "No cities match" | options fail to load: popover shows Retry, filters stay usable by URL | ticks update chips + list | zero-count options dimmed |
| Stat cards | existing loading shimmer | show 0 | show "-" | scoped numbers | n/a |

## Journey storyboard
| Step | User does | Feels | Plan specifies |
|---|---|---|---|
| 1 | Opens Drivers | oriented | cards + full list, filters in one row |
| 2 | Opens City, ticks Cuttack | in control | instant chip + list, counts beside each city |
| 3 | Adds Sedan | narrowing | second chip, counts recompute |
| 4 | Sees 0 results | briefly lost | empty state names cause + Clear filters |
| 5 | Opens a driver, presses Back | relief | URL keeps the view |
| 6 | Sends link to teammate | efficient | shareable URL |

## What already exists (reuse)
- `drivers.city_id` + index (migrations 082/083); `cityApi.list()`, `vehicleCategoryApi.list()`.
- Rides page `cityId` filter precedent (`apps/admin/app/(dashboard)/rides/page.tsx`).
- `FilterBar`, `DataTable`, `SkeletonRows`, `StatCard`, `ConfirmDialog` patterns; 400ms search debounce.
- Analytics repo already joins rides/drivers to cities (`analytics.repository.ts`).

## NOT in scope
- An Analytics-wide City selector scoping every chart (D10 B) and a Drivers-page performance strip (D10 C): declined; only the "By City" extension (R8) is built.
- Acceptance rate per city: not requested; needs new event data.
- Mobile card-list layout for phones (decision 10C declined).
- Fixing admin border drift (`#E2E8F0` vs DESIGN.md `#DCEBEE`): separate change.
- The hardcoded "+3 this week" stat badge (existing placeholder).
- Export CSV of a filtered view.

## Implementation tasks
_Superseded by the "Implementation Tasks (eng review)" section below; kept for design traceability._
- [ ] **T1 (P1, human ~3h / CC ~20min)** API: `listDrivers` accepts `cityIds` (with `none`) and `categoryIds`; select `d.city_id`, city name; return `summary` (total/active/pending/suspended) and `facets` (city + category counts under the other filters) in the same response. Files: `api/src/modules/admin/admin.repository.ts`, `admin.service.ts`, `admin.controller.ts`, types. Verify: unit test + `cd api && npx tsc --noEmit`. Parameterized SQL only, `ANY($n::bigint[])`.
- [ ] **T2 (P1, ~4h / ~30min)** `MultiSelectFilter` component on Radix Popover (add `@radix-ui/react-popover`), keyboard + ARIA per decision 9. Files: `apps/admin/components/ui/MultiSelectFilter.tsx`, `package.json`. Verify: vitest + RTL (see admin `vitest.react-pin.cjs` note).
- [ ] **T3 (P1, ~3h / ~25min)** Drivers page: URL-synced filters, chips, City column, scoped stat cards, load/error/empty states. Files: `apps/admin/app/(dashboard)/drivers/page.tsx`, `lib/admin-api.ts` (`DriverListItem.city`). Verify: manual at 1440/1024/390 + `cd apps/admin && pnpm test`.
- [ ] **T4 (P2, ~1h / ~10min)** DataTable sticky first column below 1280. Files: `apps/admin/components/ui/DataTable.tsx`. Verify: 1024px screenshot.
- [ ] **T5 (P2, ~30min / ~5min)** Wrap page in `<Suspense>` for `useSearchParams`. Verify: `next build`.

## Unresolved Decisions
None.

## Engineering review (plan-eng-review, 2026-09-27)

Target: this plan. Scope Challenge: ~11 files; original arrangement confirmed (D2 A). Prior learning applied: admin-vitest-dual-react-pin (confidence 9/10, from 2026-09-25).

## Decision ledger

### R1: which vehicle row a driver's list row and category filter use
Finding: F1, P1, confidence 9/10, `api/src/modules/admin/admin.repository.ts:169` `LEFT JOIN driver_vehicles v ON v.driver_id = d.id` (reviewer: plan-eng-review).
Plan baseline: original proposal (design plan T1 says only "select vehicle category"); no approval yet.
Runtime evidence: the unique index `driver_vehicles_one_primary_idx` (`004_m2_vehicles.sql:58`) allows one primary non-blacklisted vehicle plus any number of other rows per driver, so the current join can return a driver twice; `COUNT(*) FROM drivers d` (`admin.repository.ts:154`) does not join, so total and rows can disagree. Whether prod has such drivers: unknown, not queried.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 vehicle join | all vehicle rows, no filter | join only `is_primary AND status != 'blacklisted'` (same predicate as the unique index); category filter and facets use it | keep join as is; dedupe with DISTINCT ON in the list query only |
| R2 query strategy | pending | pending | pending |
Question D3:
D3 — Which vehicle counts for a driver in the list and the Vehicle type filter? <gstack-qid:plan-eng-review-primary-vehicle-join>
Project/branch/task: fix/post-merge-polish, Drivers filters API.
ELI10: A driver can have an old blacklisted vehicle and a current one. Today's list joins all of them, so that driver can show up twice while the total counts them once. Adding a Vehicle type filter and counts on top would make the numbers disagree.
Stakes if we pick wrong: Filtered counts and pages do not add up (for example "20 shown of 19"), and a driver may appear under the wrong vehicle type.
Recommendation: A because it matches the database's own definition of a driver's current vehicle and fixes the duplication at the source.
Completeness: A=9/10, B=6/10
Header: Vehicle join
Options:
A) Join only the primary, non-blacklisted vehicle (recommended)
✅ Every driver appears once, and totals, pages and filter counts always agree; uses the same predicate as the existing unique index.
✅ One-line change in the shared query builder, applied to list, count and facets together.
❌ A driver with only a blacklisted vehicle shows no vehicle (and no category), which is the correct meaning but differs from today's page.
B) Keep the current join and dedupe in the list only
✅ No change to what any row shows today.
✅ Smallest diff in the list query.
❌ Counts and facets still disagree with rows, so the new filter numbers can be wrong.
State: approved
Actual answer: D3 A (Join only the primary, non-blacklisted vehicle)
Accepted scope: list, count, category filter and facets join `driver_vehicles` only on `is_primary = true AND status != 'blacklisted'`, through one shared filter builder.
History: none

### R2: how the API computes list, total, summary and facet counts
Finding: F2, P1, confidence 8/10, `admin.repository.ts:154-175` (count and list are two separate statements built from one `where` string) and design plan T1 (adds summary + facets in the same response) (reviewer: plan-eng-review).
Plan baseline: design plan T1: "return `summary` and `facets` in the same response"; the query approach is not approved.
Runtime evidence: today two queries run sequentially (`await` count, then `await` data). Each facet must ignore its own filter (choosing Cuttack must still show counts for other cities), so it needs a different WHERE than the list. Row volume is small (about 181 drivers in the prototype's data; unknown in prod). `drivers_city_id_idx` exists (082); `driver_vehicles_driver_idx` exists.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 query strategy | 2 sequential queries | one `buildDriverWhere(filters, {omit})` helper; list, total and one summary/facet query per dimension run in `Promise.all` (about 5 small queries) | one large SQL statement with CTEs and conditional aggregates producing everything |
| R1 vehicle join | approved: primary only | same | same |
Question D4:
D4 — How should the API compute the list, total, summary and per-option counts? <gstack-qid:plan-eng-review-facet-query-strategy>
Project/branch/task: fix/post-merge-polish, Drivers filters API.
ELI10: The page needs the rows, a total, four summary numbers, and a count next to every city and vehicle option. Each option count must ignore its own filter, so picking Cuttack still shows how many drivers Puri has. That means several slightly different questions to the database.
Stakes if we pick wrong: Wrong counts (an option's count shrinks to 0 after you pick it), or a query nobody can safely change six months from now.
Recommendation: A because one small helper builds the WHERE clause for every query, which keeps them consistent, testable and easy to read.
Completeness: A=9/10, B=7/10
Header: Query strategy
Options:
A) Shared WHERE helper, small parallel queries (recommended)
✅ One `buildDriverWhere(filters, {omit})` used by list, total, summary and each facet, so filters cannot drift apart between queries.
✅ Each query is short and separately testable; they run together, so latency stays near one query on about 200 rows.
❌ About 5 queries per request instead of 2, which is trivial at this size but grows if driver count reaches the hundreds of thousands.
B) One combined SQL statement
✅ A single round trip.
✅ One place to look for the whole result.
❌ Long CTE with conditional aggregates that is hard to review and easy to break when a new filter is added.
State: approved
Actual answer: D4 A (Shared WHERE helper, small parallel queries)
Accepted scope: one `buildDriverWhere(filters, {omit})` helper in `admin.repository.ts` used by the list, total, summary and each facet query; the queries run in `Promise.all`; response carries `summary` and `facets`.
History: none

### R3: how malformed city and vehicle filter values are handled
Finding: F3, P2, confidence 8/10, `admin.controller.ts:1159-1160` `q.city_id = parseInt(req.query["cityId"] as string, 10);` and `:27` `q.page = parseInt(...)` with no NaN check (reviewer: plan-eng-review).
Plan baseline: design plan T1 says only "accepts `cityIds` (with `none`) and `categoryIds`"; validation not approved.
Runtime evidence: existing pattern is `parseInt` with no check, and `AppErrors.VALIDATION_ERROR` is already thrown from `admin.service.ts` (lines 119, 125, 177, 227) for bad input. What Postgres does with `NaN` cast to bigint: not probed; expected to raise a query error surfaced as a 500 (unverified).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 bad filter values | list params unvalidated (`parseInt`, NaN possible) | service parses `city`/`vehicle` as comma lists of positive integers (city also allows `none`), at most 50 entries; anything else throws `AppErrors.VALIDATION_ERROR` (HTTP 422 in this codebase, safe code only) | follow the existing `parseInt` pattern; drop non-numeric entries silently |
| R1, R2 | approved | same | same |
Question D5:
D5 — What should the API do when a city or vehicle filter value is malformed? <gstack-qid:plan-eng-review-filter-input-validation>
Project/branch/task: fix/post-merge-polish, Drivers filters API.
ELI10: The filters arrive in the URL as text like `city=1,2,none`. Someone can hand-edit that link to `city=abc`. Today's pattern would pass junk to the database and may crash with a 500; silently ignoring junk would show the wrong list without warning.
Stakes if we pick wrong: A hand-edited or corrupted shared link shows an error screen or, worse, a full unfiltered list that looks filtered.
Recommendation: A because it fails loudly with a safe 400 (no error text leaked) and the page can show its Retry error state from decision 3.
Completeness: A=9/10, B=5/10
Header: Bad filter values
Options:
A) Validate, reject malformed with 400 (recommended)
✅ Positive integers only (plus `none` for city), max 50 entries; invalid input returns the existing VALIDATION_ERROR code, never the raw error message.
✅ Matches the security rule that only codes and safe messages leave the API; the page shows its inline error, not a wrong list.
❌ A few lines of parsing code and 2 test cases; a bad link shows an error instead of loading something.
B) Follow the existing parseInt pattern, drop junk silently
✅ Zero new code and identical to the Rides `cityId` filter.
✅ A bad link still loads a page.
❌ A bad value can reach SQL as NaN (possible 500) or be dropped so the list looks filtered but is not.
State: approved
Actual answer: D5 A (Validate, reject malformed with 400)
Accepted scope: the service validates `city` and `vehicle` params as comma lists of positive integers (city also accepts `none`), at most 50 entries; anything else throws `AppErrors.VALIDATION_ERROR` (HTTP 422 in this codebase, safe code only, no raw error text).
History: none

### R4: how the page ignores out-of-date list responses
Finding: F4, P2, confidence 8/10, `apps/admin/app/(dashboard)/drivers/page.tsx:71-80` `const res = await adminDriverApi.list({...}); setDrivers(res.drivers) ...` inside `fetchList` with no cancellation or ordering guard (reviewer: plan-eng-review).
Plan baseline: design decision 3A (approved): "never show stale rows under new chips"; decision 8A (approved): filters apply instantly on each tick. Neither says how an old response is discarded.
Runtime evidence: `fetchList` is a `useCallback` re-run by an effect on every dependency change; each call sets state from whichever response resolves last, so a slow earlier request can overwrite a newer one. `adminDriverApi.list` (`apps/admin/lib/admin-api.ts:107-115`) forwards only `params` to axios and has no `signal`. Not probed live.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R4 stale responses | none: last response to arrive wins | abort the previous request with `AbortController` (pass `signal`), ignore the cancel error | keep a request counter in a ref; ignore any response whose number is not the latest | rely on the short debounce only |
| R1, R2, R3 | approved | same | same | same |
Question D6:
D6 — How should the Drivers page stop an old response from replacing a newer one? <gstack-qid:plan-eng-review-stale-response-guard>
Project/branch/task: fix/post-merge-polish, Drivers page instant filtering.
ELI10: Ticking three cities quickly sends three requests. If the first one is slow and lands last, the table would show the first city's drivers under all three chips. That is the "looks right but is wrong" failure we already ruled out in the design review.
Stakes if we pick wrong: Admins occasionally see rows that do not match the chips, with no error, on a page used to make ops decisions.
Recommendation: B because a request counter is about three lines, needs no API-wrapper change, and fully prevents the wrong-rows case.
Completeness: A=9/10, B=9/10, C=4/10
Header: Stale responses
Options:
A) Abort the previous request (AbortController)
✅ Cancels the old request in the browser, so the server-side work can also stop and no late response arrives at all.
✅ Standard pattern; axios supports `signal`.
❌ Needs a `signal` argument added to `adminDriverApi.list`, plus handling of the cancel error so it does not trigger the error state from decision 3.
B) Ignore all but the latest response with a request counter (recommended)
✅ About three lines inside `fetchList`; no change to `adminDriverApi.list` and no cancel-error special case.
✅ Guarantees the table only ever shows the newest request's rows.
❌ Old requests still run to completion on the server (negligible at about 200 drivers).
C) Rely on the debounce alone
✅ Zero code.
✅ Fewer requests when ticking quickly.
❌ Does not prevent out-of-order responses; a slow request can still overwrite a newer one.
State: approved
Actual answer: D6 B (Ignore all but the latest response with a request counter)
Accepted scope: `fetchList` in `drivers/page.tsx` increments a ref counter per call and applies a response (rows, summary, facets, error) only if its number is still the latest; `adminDriverApi.list` is unchanged.
History: none

### R5: regression proof for the existing driver list contract
Finding: F5, P1 (IRON RULE regression), confidence 9/10, `admin.repository.ts:129-198` `listDrivers` and `drivers/page.tsx:107` `const pending = drivers.filter(d => d.status === 'pending_approval')` (reviewer: plan-eng-review).
Plan baseline: design plan T1/T3 verify with "unit test + tsc" and "manual at 1440/1024/390"; no regression test for the existing behavior is approved.
Runtime evidence: `grep -rln listDrivers api/src api/tests` finds only source files (repository, service, controller, migration 059 comment) and no test; `api/tests/integration/m04.test.ts` exercises other admin driver endpoints (status change), so an integration harness exists. CLAUDE.md: integration tests need a proper TEST_DATABASE_URL; unit tests run cleanly. The vehicle-join change (R1) and the new WHERE builder (R2) rewrite the query behind an untested endpoint.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R5 regression proof | none for `GET /admin/drivers` | integration test on a real DB: unfiltered response keeps its shape, order (`created_at DESC`) and pagination; `status` and `search` still work; then new city/vehicle/none filters, facets ignore their own dimension, a driver with two vehicle rows appears once, malformed values return 400 | unit test with a mocked pool that asserts generated SQL text and parameters |
| R1-R4 | approved | same | same |
Question D7:
D7 — How should we prove the existing driver list still behaves the same after the rewrite? <gstack-qid:plan-eng-review-list-regression-tests>
Project/branch/task: fix/post-merge-polish, tests for the Drivers list API.
ELI10: The list query is being rewritten (new filters, primary-vehicle join, shared WHERE builder) and today no test covers it. If a plain, unfiltered list quietly changes order or drops a status filter, nobody notices until an admin does. The choice is what kind of test guards it.
Stakes if we pick wrong: A silent break in the most-used admin list, or tests that only check SQL text and miss a wrong join.
Recommendation: A because the risk is in the SQL joins and counts, which only a real database run can prove.
Completeness: A=9/10, B=5/10
Header: List regression tests
Options:
A) Integration test against the real database (recommended)
✅ Proves the actual joins, counts and pagination: unfiltered contract, status/search, city/vehicle/none filters, facets, duplicate-vehicle driver, 400s.
✅ Follows the existing `api/tests/integration/m04.test.ts` pattern, so no new test setup.
❌ Needs TEST_DATABASE_URL, so it does not run in a plain `pnpm test` without the test database.
B) Unit test with a mocked pool
✅ Runs anywhere with no database.
✅ Fast and easy to write.
❌ Only checks SQL text and parameters, so a wrong join or count would still pass.
State: approved
Actual answer: D7 A (Integration test against the real database)
Accepted scope: an integration test in `api/tests/integration/` (pattern: `m04.test.ts`) covering the unfiltered list contract (shape, `created_at DESC`, pagination), status and search, city/vehicle/`none` filters, facets ignoring their own dimension, a driver with two vehicle rows appearing once, and 400 on malformed values.
History: none

### R6: pending-approval banner only sees the current page
Finding: F6, P3, confidence 9/10, `apps/admin/app/(dashboard)/drivers/page.tsx:107` `const pending = drivers.filter(d => d.status === 'pending_approval')` where `drivers` is one page (`LIMIT = 20`, line 42) (reviewer: plan-eng-review).
Plan baseline: design plan says the banner is "unchanged"; no disposition for its page-limited behavior.
Runtime evidence: the banner and the "Pending Approval" card both derive from `drivers` today, so they always agree. After approved decision 1A the card becomes a server-side count while the banner stays page-limited, so with more than 20 matching drivers the card can say 3 while the banner lists 2.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R6 banner scope | current page only | add a TODOS.md item, keep banner as is | skip | build now: banner uses its own request `status=pending_approval` with the active city/vehicle filters, limit 50 |
| R1-R5 | approved | same | same | same |
Question D8:
D8 — What should we do about the pending-approval banner only seeing the current page? <gstack-qid:plan-eng-review-pending-banner-todo>
Project/branch/task: fix/post-merge-polish, Drivers page approval banner.
ELI10: The yellow "drivers awaiting approval" banner lists only pending drivers found among the 20 rows on screen. Once the top cards show true totals, the two can disagree when many drivers match. Today pending drivers are the newest, so they are usually on page 1.
Stakes if we pick wrong: An admin misses a pending driver on page 2, or we spend time on an edge case that rarely happens.
Recommendation: A because it is rare today (pending drivers sort newest-first), so track it rather than widen this change.
Completeness: Note: options differ in kind, not coverage — no completeness score.
Header: Banner TODO
Options:
A) Add to TODOS.md (recommended)
✅ Records the mismatch with What/Why/Context so it is picked up when pending volume grows.
✅ Keeps this change limited to the approved filters.
❌ The card and banner can disagree until it is done.
B) Skip, not valuable enough
✅ No extra file churn or follow-up work.
✅ Real impact is small while pending drivers are newest.
❌ The mismatch stays undocumented and can surprise a future reader.
C) Build it now in this PR
✅ Banner always matches the card and never misses a pending driver.
✅ Removes the mismatch before it can appear.
❌ Adds a second list request and its loading/error handling to the page, beyond the approved design.
State: approved
Actual answer: D8 C (Build it now in this PR)
Accepted scope: the pending-approval banner gets its own list request (`status=pending_approval`, the active city/vehicle filters, limit 50) so it no longer depends on the current page; it uses the R4 latest-response counter, its own loading state and the same inline error/Retry from design decision 3.
History: none

### R7: per-city performance follow-up
Finding: F7, P3, confidence 8/10, `api/src/modules/analytics/analytics.repository.ts:109` `LEFT JOIN rides r ON r.origin_city_id = c.id AND r.status = 'completed'` and `:195`, `:238` `LEFT JOIN cities c ON c.id = d.city_id` (reviewer: plan-eng-review).
Plan baseline: design plan NOT in scope: "Per-city performance (rides, revenue, acceptance, cancellations): belongs on Analytics with a city selector"; no follow-up recorded.
Runtime evidence: the Analytics repository already joins rides and drivers to cities at the three lines above; whether the analytics endpoints accept a city filter today: unknown, not read in full. The original request asked whether the filters show a city's performance; this plan only shows supply (drivers, active, pending).
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R7 city performance | not tracked | add a TODOS.md item for an Analytics city selector | skip | build now in this PR |
| R1-R6 | approved | same | same | same |
Question D9:
D9 — Should we track "per-city performance on Analytics" as a follow-up? <gstack-qid:plan-eng-review-city-performance-todo>
Project/branch/task: fix/post-merge-polish, answering "will the city filter show city performance?".
ELI10: The new Drivers filters show how many drivers a city has and their status. They do not show rides, revenue or cancellations per city. Those numbers already have partial groundwork in the Analytics code but no city picker, so it needs a separate small piece of work.
Stakes if we pick wrong: The question that started this work ("how is a city performing?") stays unanswered and is forgotten.
Recommendation: A because it records the real goal without growing this change.
Completeness: Note: options differ in kind, not coverage — no completeness score.
Header: City performance
Options:
A) Add to TODOS.md (recommended)
✅ Keeps the original goal visible with What/Why/Context, including the existing Analytics joins to start from.
✅ Leaves this change limited to the approved filters and banner.
❌ City performance is not available until that follow-up is built.
B) Skip, not valuable enough
✅ No extra backlog item.
✅ Filters alone already help ops see driver supply per city.
❌ The reason the filters were requested goes untracked.
C) Build it now in this PR
✅ Answers the performance question immediately.
✅ Reuses the existing Analytics city joins.
❌ Adds a new API/UI surface far beyond the reviewed filters plan and would need its own design and eng review.
State: approved
Actual answer: D9 C (Build it now in this PR), bounded by D10 A
Accepted scope: see R8 (Analytics "By City" extension); no Drivers-page performance strip and no Analytics-wide city selector.
History: D9 (options A add TODO / B skip / C build now) answered C. New evidence before applying it: `analytics.repository.ts:102` `getCityBreakdown` already returns completed rides and revenue per city, the Analytics page already renders it as "By City" (`apps/admin/app/(dashboard)/analytics/page.tsx:250-261`), and `getDriverOnboardingFunnel`/`getDriverAvailability` already group by city. D9's "no city picker" wording understated this; what is missing is cancellation and driver supply beside those numbers, and any link from Drivers. C is unbounded (metrics and page), so it is reopened as D10 rather than guessed. Original D9 brief and answer kept here.

### R8: what "build city performance now" means
Finding: F7 (continued), P3, confidence 8/10, `analytics.repository.ts:102-121` `getCityBreakdown`, `analytics.types.ts:23` `CityBreakdown`, `apps/admin/app/(dashboard)/analytics/page.tsx:250-261` "By City" chart (reviewer: plan-eng-review).
Plan baseline: D9 C: build city performance in this PR; surface and metrics not approved.
Runtime evidence: `getCityBreakdown` filters `r.status = 'completed'` in the JOIN (line 109), so cancelled rides are never counted per city today; the chart shows a label and value only. Exact columns returned: not read beyond lines 102-121.
Comparison grid:
| Choice | Current | A | B | C |
|---|---|---|---|---|
| R8 surface | "By City" shows completed rides/revenue only | extend "By City" with cancellations, cancellation rate and active drivers (API + types + one table on Analytics) | add a City selector that scopes every Analytics section (7 repository functions gain a city predicate) | a per-city summary strip on the Drivers page from the new `summary`/`facets` |
| R1-R7 | approved | same | same | same |
Question D10:
D10 — Which per-city performance surface should be built now? <gstack-qid:plan-eng-review-city-performance-surface>
Project/branch/task: fix/post-merge-polish, per-city performance (from the original request).
ELI10: You chose to build city performance now. Analytics already shows completed rides and revenue for every city side by side. What it lacks is cancellations and how many drivers each city has. I need you to pick the one place and set of numbers to build so it does not grow without a stop.
Stakes if we pick wrong: A big new feature slips into a filters change, or the numbers land somewhere admins never look.
Recommendation: A because it reuses the existing "By City" query and page, answers "how is each city doing?" directly, and touches the fewest files.
Completeness: A=8/10, B=9/10, C=6/10
Header: Performance surface
Options:
A) Extend the Analytics "By City" section (recommended)
✅ Adds cancelled rides, cancellation rate and active drivers per city next to the existing revenue and ride counts, all cities visible at once.
✅ Reuses `getCityBreakdown` and the current section; about 4 files (repository, types, service passthrough, Analytics page).
❌ Compares cities only; it does not let you drill into one city's daily revenue or funnel.
B) Add a City selector that scopes the whole Analytics page
✅ Every chart (revenue trend, funnel, top drivers) can be viewed for one city, the fullest answer.
✅ Same selector can later link from the Drivers city filter.
❌ Touches 7 repository queries plus the page and needs its own design and eng review, so it is much bigger than this change.
C) Add a per-city strip on the Drivers page
✅ Performance sits right beside the new filters.
✅ No Analytics page change.
❌ Would need ride data joined into the Drivers summary query, mixing supply and demand metrics on one page, and duplicating Analytics logic.
State: approved
Actual answer: D10 A (Extend the Analytics "By City" section)
Accepted scope: `getCityBreakdown` (`analytics.repository.ts`), `CityBreakdown` (`analytics.types.ts`) and the "By City" section of `apps/admin/app/(dashboard)/analytics/page.tsx` gain, per city and for the selected period: cancelled rides (rides with `status = 'cancelled'` by `origin_city_id`), cancellation rate (cancelled / (completed + cancelled), 0 when there are no rides), and active drivers (drivers with `status = 'active'` and `city_id` = the city, current count). No city selector, no Drivers-page strip. Metric formulas are stated here as the approved behavior and may be tuned only through a reopened decision.
History: none

Approval readiness: PASS. Checked R1 (D3 A), R2 (D4 A), R3 (D5 A), R4 (D6 B), R5 (D7 A), R6 (D8 C), R7 (D9 C, bounded by D10), R8 (D10 A); each cites its own actual answer. Setup answers (D1 learnings, D2 arrangement) approve no remedy.

## Engineering findings (all resolved into the plan)
1. [P1] (confidence: 9/10) `api/src/modules/admin/admin.repository.ts:169` `LEFT JOIN driver_vehicles v ON v.driver_id = d.id` duplicates drivers with a non-primary vehicle row. Resolved: R1.
2. [P1] (confidence: 8/10) `admin.repository.ts:154-175` count and list built separately; new facets/summary must ignore their own dimension. Resolved: R2.
3. [P2] (confidence: 8/10) `admin.controller.ts:1159-1160` `parseInt` with no NaN check. Resolved: R3.
4. [P2] (confidence: 8/10) `drivers/page.tsx:71-80` no ordering guard, so a slow older response can overwrite a newer one. Resolved: R4.
5. [P1] (confidence: 9/10) no test covers `GET /admin/drivers` before it is rewritten. Resolved: R5.
6. [P3] (confidence: 9/10) `drivers/page.tsx:107` banner sees only the current page of 20. Resolved: R6 (built now).
7. [P3] (confidence: 8/10) city performance question only half answered by supply counts; Analytics "By City" lacks cancellations and driver supply. Resolved: R7/R8.

Architecture: no other issues (auth unchanged, all SQL parameterized with `ANY($n::bigint[])`, no new service). Code quality: MultiSelectFilter has two callers on this page (City, Vehicle), which meets the two-caller bar; Rides `cityId` may adopt it later (not committed). Performance: no issues; each page load now issues up to ~10 short queries (5 for the list, 5 for the banner request) against `DATABASE_POOL_MAX` 15 with `statement_timeout` 10s; the pool queues rather than fails at this data size (~200 drivers). Ceiling: revisit if drivers reach tens of thousands or many admins load at once.

## What already exists (engineering)
Reused: `drivers.city_id` + `drivers_city_id_idx` (082/083), `driver_vehicles_one_primary_idx` predicate for R1, `AppErrors.VALIDATION_ERROR`, `cityApi.list()`, `vehicleCategoryApi.list()`, `SkeletonRows`, `DataTable`, Analytics `getCityBreakdown` and the "By City" section, `api/tests/integration/m04.test.ts` harness, admin `vitest.react-pin.cjs` setup (prior learning admin-vitest-dual-react-pin). New: `buildDriverWhere`, `MultiSelectFilter`, one dependency `@radix-ui/react-popover`.

## Diagrams
```
Browser: Drivers page                              API: GET /api/v1/admin/drivers
 URL ?city=1,2,none&vehicle=3&status=&q=&page=      controller -> service: validate (400 VALIDATION_ERROR)
   | router.replace, search debounced 400ms                 |  Promise.all
   v                                                        v
 fetchList(#n) ---------------------------------->  buildDriverWhere(filters, {omit})
   ignore response if n is not latest (D6 B)          |- list   primary-vehicle JOIN, LEFT JOIN cities
   v                                                  |- total
 rows + cards(summary) + popover counts(facets)       |- summary (status counts, scoped)
 banner: fetchPending(#m) status=pending_approval     |- facet city     (omits city filter)
   limit 50, same city/vehicle filters (D8 C)         `- facet category (omits vehicle filter)

Analytics: By City (R8)  getCityBreakdown(days): + cancelled, cancellation rate, active drivers
```
Failure to keep in mind: a facet query failing fails the whole request (500), by design; the page shows its inline error + Retry rather than partial numbers.

## Test review
```
CODE PATHS                                              USER FLOWS
[+] api admin.repository.ts listDrivers                 [+] Drivers page
  |- [PLANNED ★★★ integ] unfiltered contract + order      |- [PLANNED ★★★ page test] tick city -> URL + chip + rows
  |- [PLANNED ★★★] status + search                        |- [PLANNED ★★★] Back from driver keeps filters via URL
  |- [PLANNED ★★★] city ids / none / vehicle ids          |- [PLANNED ★★★] rapid ticks: stale response ignored
  |- [PLANNED ★★★] primary-vehicle join (2-row driver)    |- [PLANNED ★★★] 400/500 -> inline error + Retry
  |- [PLANNED ★★★] facets omit own dimension              |- [PLANNED ★★ ] zero results -> names filters + Clear
  `- [PLANNED ★★★] summary counts scoped                  `- [PLANNED ★★ ] banner uses its own request
[+] api admin.service.ts param parsing                  [+] MultiSelectFilter
  `- [PLANNED ★★★] malformed / >50 entries -> 400          |- [PLANNED ★★★ component] keyboard open/arrows/space/Esc focus
[+] api analytics getCityBreakdown                        `- [PLANNED ★★ ] zero-count dimmed, selected stays
  |- [PLANNED ★★★ integ] cancelled, rate, 0 division    [+] Analytics page "By City"
  `- [PLANNED ★★ ] active drivers                          `- [GAP] no page test; manual check at 1440

COVERAGE NOW: 0/18 paths tested (no test touches GET /admin/drivers)  |  AFTER PLAN: 17/18
QUALITY (planned): ★★★:11 ★★:6  |  GAPS: 1 (Analytics page, manual)
```
E2E: none proposed; admin has no E2E harness, so Back-navigation is covered with a mocked router in the page test plus the manual pass at 1440/1024/390. LLM/eval: not applicable. Regression: R5 (approved) is the mandatory regression contract; planned tests are required proof of approved behavior, not new policy.

## Failure modes
| Path | Realistic failure | Test / handling | User sees |
|---|---|---|---|
| list + facets | one facet query errors -> 500 | page test for error state | inline "Couldn't load drivers" + Retry (clear) |
| filter params | hand-edited link `city=abc` | integration 400 test | inline error, not a wrong list (clear) |
| filter chips | selected city id no longer in `cityApi.list()` (deleted/inactive) | page test: chip falls back to "City #id" | a chip and an empty state naming it (clear) |
| stale response | slow older request lands last | request counter (D6 B) + page test | latest rows only (clear) |
| banner request | fails while list succeeds | handled with same inline error scoped to the banner | banner error + Retry (clear) |
| By City rate | city with 0 rides | integration test asserts rate 0, not NaN | "0%" (clear) |
Critical gaps: 0 (no path is untested, unhandled and silent).

## Worktree parallelization strategy
| Step | Modules touched | Depends on |
|------|----------------|------------|
| T1-T2 API drivers list + integration test | api/src/modules/admin, api/tests | none |
| T6 Analytics API extension | api/src/modules/analytics, api/tests | none |
| T3 MultiSelectFilter + DataTable sticky column | apps/admin/components | none |
| T4 Drivers page | apps/admin/app/(dashboard)/drivers, apps/admin/lib | T1 (response contract), T3 |
| T7 Analytics page | apps/admin/app/(dashboard)/analytics | T6 |

Lane A: T1 -> T2 (api admin module). Lane B: T6 -> T7 (analytics API then page). Lane C: T3 + T5 (admin components). Lane D: T4 (after A and C).
Execution order: launch A, B and C in parallel; merge A and C; then run D. Conflict flags: T4 and T7 both touch `apps/admin` but different route folders, so they do not conflict; `package.json` (@radix-ui/react-popover) is touched only by Lane C.

## Implementation Tasks (eng review)
Synthesized from this review's findings. Each task derives from a specific finding above.
- [ ] **T1 (P1, human ~4h / CC ~25min)** — API drivers list — filters, facets, summary, primary-vehicle join, validation
  - Surfaced by: R1, R2, R3 (`admin.repository.ts:154-175`, `:169`; `admin.controller.ts:25-29`)
  - Files: `api/src/modules/admin/admin.repository.ts`, `admin.service.ts`, `admin.controller.ts`, `admin.types.ts`
  - Verify: `cd api && npx tsc --noEmit` and T2
- [ ] **T2 (P1, ~3h / ~20min)** — API tests — integration test for the list contract and new filters
  - Surfaced by: R5 (no test covers `GET /admin/drivers`)
  - Files: `api/tests/integration/admin-drivers-list.test.ts`
  - Verify: `cd api && pnpm test` with TEST_DATABASE_URL set
- [ ] **T3 (P1, ~4h / ~30min)** — MultiSelectFilter on Radix Popover + component test
  - Surfaced by: design decisions 8A, 9A, 11A; prior learning admin-vitest-dual-react-pin
  - Files: `apps/admin/components/ui/MultiSelectFilter.tsx` (+ test), `apps/admin/package.json`, `pnpm-lock.yaml`
  - Verify: `cd apps/admin && pnpm test`
- [ ] **T4 (P1, ~4h / ~30min)** — Drivers page — URL sync, chips, City column, scoped cards, states, request counter, own-request banner, Suspense
  - Surfaced by: R4, R6 and design decisions 1A-5A
  - Files: `apps/admin/app/(dashboard)/drivers/page.tsx` (+ test), `apps/admin/lib/admin-api.ts`
  - Verify: `cd apps/admin && pnpm test`, then `next build`, then manual at 1440/1024/390
- [ ] **T5 (P2, ~1h / ~10min)** — DataTable — pinned first column below 1280
  - Surfaced by: design decision 10A
  - Files: `apps/admin/components/ui/DataTable.tsx`
  - Verify: 1024px screenshot
- [ ] **T6 (P2, ~2h / ~15min)** — Analytics API — cancelled, cancellation rate, active drivers per city
  - Surfaced by: R7/R8 (`analytics.repository.ts:102-121`)
  - Files: `api/src/modules/analytics/analytics.repository.ts`, `analytics.types.ts` (+ integration assertions)
  - Verify: `cd api && npx tsc --noEmit` and the integration test
- [ ] **T7 (P2, ~1h / ~10min)** — Analytics page — "By City" shows the new columns
  - Surfaced by: R8 (`analytics/page.tsx:250-261`)
  - Files: `apps/admin/app/(dashboard)/analytics/page.tsx`
  - Verify: manual check at 1440

## TODOS.md updates
None proposed: the banner (D8) and city performance (D9/D10) were both chosen to build now, and no other deferred item remains.

## Suppressed findings (confidence below 5, appendix only)
- [P3] (confidence: 4/10) `analytics.repository.ts:109-110` `LEFT JOIN payments p ON p.ride_id = r.id AND p.status = 'completed'` after counting `COUNT(r.id)` could over-count rides if a ride has more than one completed payment row. Could not verify payments uniqueness; check while doing T6.

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge: scope accepted as-is (original arrangement, D2 A); scope then grew by D8 C and D9 C/D10 A (banner request, Analytics "By City" extension).
- Architecture Review: 2 issues found (R1, R2)
- Code Quality Review: 4 issues found (R3, R4, R6, R7)
- Test Review: diagram produced, 1 gap identified (R5 regression coverage), 1 manual-only path
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (both candidates built now)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (401 Unauthorized: Invalid token; native fallback not run, no TaskOutput tool)
- Parallelization: 4 lanes, 3 parallel / 1 sequential
- Lake Score: 5/6 chose the highest-completeness option (D10 chose the smaller surface on purpose)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | - | - |
| Outside Review | codex, `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable | 401 Unauthorized: Invalid token; no coverage |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (PLAN) | 7 issues (all resolved into the plan), 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score: 3/10 -> 8/10, 11 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | - | - |

**OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (auth failed with 401 Invalid token; repair with `codex login`). The native fallback did not run, so this review has no outside opinion.
**VERDICT:** DESIGN CLEARED. ENG REVIEW ISSUES OPEN: all 7 findings are resolved into the plan (`issues_open` counts resolved findings), implementation pending; eng review required before /ship.

NO UNRESOLVED DECISIONS
