# Reports Page (`/analytics`) — Audit and Redesign Plan

Date: 2026-09-29. Status: **PLAN, nothing implemented.** Design review ratings below are pre-approval; the per-issue
decisions in section 9 are still open.

Evidence: screenshots in `.scratch/reports-audit/` (`desktop-tall.png` full page 1440w, `tablet.png` 768w,
`mobile.png` 390w), captured from the local dev admin against seeded data. Code:
`apps/admin/app/(dashboard)/analytics/page.tsx` (450 lines, one file), `api/src/modules/analytics/*`.
Design source of truth: `DESIGN.md` + `PRODUCT.md` (no new design system needed; see section 6 for the two gaps to add).

---

## 1. Users and jobs (what "Reports" must answer)

Roles allowed today: `super_admin`, `finance_admin` (nav) / + `ops_admin` (API). Desktop-primary, must work at 768.

| Persona | Question they arrive with | Today |
|---|---|---|
| Ops lead | "Are we healthy this week, and where is it breaking (which city / hour / category)?" | Partly. No trend vs before, no time-of-day, no cause of cancellations |
| Finance | "What did we earn, what do we owe drivers, what can I hand to the accountant?" | No. Revenue only; no commission/take rate, no payouts, refunds, cash vs online, **no export** |
| Founder | "Is it growing? One glance." | No headline KPIs, no deltas |

## 2. Audit — what the screenshots show (top to bottom)

Severity: **P0** wrong or misleading, **P1** blocks the job, **P2** polish.

| # | Finding | Evidence | Sev |
|---|---|---|---|
| 1 | **Every fetch failure renders as "No data" / zero-ish charts.** `catch { setData(EMPTY) }` — an API outage is indistinguishable from a quiet month. Ops will trust a wrong page. | `page.tsx:126-128, 138-140, 149-151` | P0 |
| 2 | **Tablet (768w) charts collapse:** Ride Funnel / By City / By Category show y-axis labels and **no bars**. 3-col grid at `md` leaves ~110px plot width after the fixed 90px `YAxis`. | `tablet.png` | P0 |
| 3 | Sidebar has **Snapshots** (`demo: true`) with **no page** behind it; topbar subtitle promises "Analytics and exports" but there is **no export anywhere**. | `AdminSidebar.tsx:78`, `layout.tsx:32` | P1 |
| 4 | No headline KPIs. The first thing seen is one number (revenue) and a chart. Gross bookings, rides, completion %, cancellation %, take rate, active drivers are absent or buried in tables. | `desktop-tall.png` top | P1 |
| 5 | **No comparison to previous period.** A number with no delta is not a report. | whole page | P1 |
| 6 | Period selector is 7/30/90 only. No custom range, no city / category filter, no "today". Finance needs calendar months. | header | P1 |
| 7 | Revenue chart with one data point shows a **lone dot** (no line, no area). Low-data state was never designed. Seen on 30d in seeded data. | `desktop-tall.png` | P1 |
| 8 | "By City" lists **all 10 cities incl. 7 zero rows**, bar chart and table repeat the same cities twice, column is 3x taller than its siblings and leaves large dead space in Funnel/Category cards. | seg1/seg2 | P1 |
| 9 | Chart tooltips: Recharts default look (not on token, no ₹ compact, no date formatting; X axis shows raw `2026-09-18`). Y axis `2200/1650/...` unformatted (should be `₹2.2k`). | `page.tsx:50-55` | P2 |
| 10 | Funnel is a bar chart of 4 unrelated-scale bars, not a funnel: cancelled is not a stage after completed. Conversion % is only in the tooltip. | `page.tsx:226-246` | P1 |
| 11 | `ETA accuracy` endpoint exists (`/analytics/eta-accuracy`) and is **not used** by any UI. | `analytics.routes.ts:32` | P2 |
| 12 | Tables use `.data-table tr {cursor:pointer}` and `.admin-card:hover` lift on **non-interactive** rows/cards. Implies clickability that does nothing. No drill-through (a city row should open Rides filtered to that city). | globals.css:44,63 | P1 |
| 13 | Title duplicated: topbar says "Reports" and the page repeats an `h1` "Reports". | seg1 | P2 |
| 14 | Period buttons are ~32px tall (PRODUCT.md: 44px targets). Micro text at 11-12px, muted grey on tinted surface near the 4.5:1 line. | header, axes | P2 |
| 15 | Availability card polls every 60s with **no "updated Ns ago"**, no pulse; live vs period-scoped data sit side by side without saying which is which (only subtitle text). | seg2 | P2 |
| 16 | Motion: content swaps instantly on period change (skeleton → data, no crossfade, no number count, charts re-mount). Nothing is animated meaningfully; nothing is broken by reduced-motion either (global override exists). | code | P2 |
| 17 | Colour-only state: conversion/availability cells are red/amber/green text with no icon or label (PRODUCT.md: colour never the sole indicator). Category bars use 5 rotating colours with no meaning. | seg2, `page.tsx:295` | P2 |
| 18 | Cookie notice sits over the bottom-right of content on every load (global, not Reports-specific — note only). | all shots | P2 |
| 19 | One 450-line file mixes data fetching, 3 chart types, 4 tables. No error/empty/loading contract shared with other admin pages. | code | P2 |
| 20 | Mobile (390w) is acceptable. Sidebar collapses to icon rail, cards stack, funnel bars render. Reports is a desktop task; mobile only needs "does not break". | `mobile.png` | ok |

**Initial design-completeness rating: 4/10.** Solid tokens and layout shell, but it is a chart gallery, not a reporting tool: no
hierarchy of insight, no comparison, no export, no error states, one responsive bug.

## 3. Research — what good ride-hailing / ops reporting does

- **Uber for Business / Fleet Hub:** reports are **generated, filtered and downloadable** (customisable CSV columns, emailed link,
  "View exports" list); fleet view gives per-driver **acceptance rate, completion rate, gross fares, cash collected, hours online,
  trips per hour, rating**. ([activity reports](https://help.uber.com/en/business/article/downloading-activity-reports?nodeId=b80b35dc-bfb9-428b-88c6-f7af84e7eea5),
  [Fleet Hub](https://help.uber.com/en/fleet/article/fleet-hub-portal--managing-your-fleet-faq?nodeId=5f9fab81-ea42-4251-9d8f-d33cdec7aae6))
- **Bolt / fleet portals:** real-time fleet status plus driver-quality reports (completed trips, acceptance, cancellation) and
  balance/earnings-and-collections reports. ([Bolt Fleet](https://fleets.bolt.eu/))
- **Ride-hailing KPI canon (analyst dashboards):** booking funnel + cancellation ratio and *why*, demand concentration by
  place and **time of day**, driver **utilisation**, average booking value, payment-method mix, supply/demand heatmaps.
  ([ride-hailing dashboard KPIs](https://www.inetsoft.com/info/shared-rider-system-dashboards/),
  [demand/supply analysis](https://medium.com/@Sidlawan/the-road-to-balance-a-demand-and-supply-analysis-of-ride-hailing-service-dca8609c2b66))
- **Reporting UX conventions:** KPI values shown against a **comparison period**; export as CSV/PNG/PDF; scheduled delivery;
  executive views have 0-1 filter, operational views 2-4; keep under ~15 widgets. ([dashboard best practices](https://www.reportviewers.com/dashboard-design-guide.html),
  [Zendesk export](https://support.zendesk.com/hc/en-us/articles/4483481898266-Exporting-dashboard-tabs-and-reports))

Layer-3 takeaway for Ocar (small Odisha ops team, 3 core cities + 7 smaller, cash-heavy, intercity): do **not** copy Uber's
enterprise report builder. Steal three things: KPI strip with deltas, driver-quality table, and downloadable finance CSV.
Skip scheduled email, custom report builder, PDF designer until someone asks.

## 4. Target information architecture

One page, four tabs (same tab pattern as admin Vehicles page — reuse, don't invent). Global filter bar is sticky and applies to all tabs.

```
Reports                         [ Date range v ] [ Cities v ] [ Category v ]  [ Compare: prev period v ]   [ Export v ]
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
Overview | Rides & Demand | Drivers | Revenue & Payouts
```

**Overview (default; answers "healthy?" in 5 seconds)**
1. KPI band (6, one connected card with hairline dividers; design D2/D5): Gross bookings ₹, Ocar revenue (commission), Completed rides, Completion %, Cancellation %, Active drivers. Each = value + delta vs previous period + sparkline. Click = jump to the tab that explains it. Take rate, refund rate and dispute rate live on the Finance tab (design D2 supersedes the earlier "take rate on the strip").
2. Trend chart (revenue by day, metric toggle: Gross / Net commission / Rides) with previous-period dashed overlay.
3. "Needs attention" list (max 4, auto-generated): city with cancel % over threshold, city with availability under 30%, onboarding stalled, ETA accuracy worse than last period. This replaces the current colour-only cells and makes the page opinionated.

**Rides & Demand:** true funnel (Requested → Accepted → Started → Completed, with drop-off % between stages; Cancelled shown as a separate exit split by who/why); **rides by hour x weekday heatmap**; by city (top 5 + "other", zero rows hidden behind "show all"); by category (one colour, meaning = share); ETA accuracy (use the unused endpoint).

**Drivers:** Top drivers → full **driver quality** table (trips, acceptance %, completion %, cancel %, earnings, hours online, rating), sortable, row click opens the existing driver slide-over; onboarding funnel by city; live availability (with "updated Ns ago" + live dot). Utilisation = online-hours with trip / online-hours.

**Revenue & Payouts (finance_admin lens):** gross, commission, driver earnings, cash vs online split, refunds, payouts pending/paid, settlements. Ledger-backed table with **Export CSV** (the accountant's page). Rows drill to Payments/Payouts pages.

Explicitly **not** doing (subtraction): report builder, scheduled email, PDF export, saved views, cohort retention, driver-tier prediction. Revisit on request.

## 5. Interaction, states, responsive (specified, not "TBD")

- **States every widget has:** loading (skeleton matching final geometry, no layout shift), empty ("No completed rides in Puri for this range" + what to change), **error** (inline "Couldn't load, Retry", other widgets keep working; never fall back to zeros), stale (live widgets: "Updated 12s ago").
- **Low data:** if < 3 points, line chart renders as bars/dots with a caption instead of a lone dot; sparklines hide under 3 points.
- **Number formatting:** one helper — `₹1.2L`/`₹2.2k` compact on axes/KPIs, full `₹1,22,000` in tooltip and tables (en-IN). Dates `18 Sep`. Tabular numerals everywhere.
- **Filters:** URL search params are the state (`?range=30d&city=3&cmp=prev&tab=drivers`) so a link is shareable and back/forward works. Default 30d, all cities, compare on.
- **Drill-through:** any city/driver/category label is a real link/button with visible affordance and focus ring; non-interactive rows lose `cursor-pointer` and card hover-lift.
- **Export:** CSV per tab, generated server-side (streamed) with the active filters; file name `ocar-<tab>-<from>_<to>.csv`; UTF-8 BOM so Excel renders ₹. Async job only if row count > 50k (BullMQ exists) — start synchronous.
- **Responsive:** ≥1280 KPI strip 6-up, charts 2-col; 768-1279 KPI 3x2, charts **1-col** (fixes finding 2; chart cards never below 480px wide); <768 KPI 2x3, tables become horizontally scrollable with sticky first column, filters collapse into one "Filters (3)" sheet. Touch targets 44px.
- **Accessibility:** every chart has a table alternative (toggle "View as table"), colour + icon/label for state, `role="img"` + summary label on charts, keyboard reach for tooltips (Recharts `accessibilityLayer`), 4.5:1 for all text, min 12px chart text and 14px table text.

## 6. Visual + motion system (extends DESIGN.md — add a "Data visualisation & motion" section)

Keep the Reliable Route language: white cards on `#F6FBFB`, teal `#0E8FA3` as the single accent, `rounded-2xl`, Space Grotesk for the
big numbers, Plus Jakarta for UI, tabular figures. "Premium" here means **restraint and precision**, not gradients (PRODUCT.md anti-reference:
generic SaaS template). Concretely:

**Data-viz tokens (new):** one categorical ramp of max 5 (SUPERSEDED by design D6: `{colors.primary}`, `{colors.primary-dark}`, `{colors.info}`, `{colors.ink-600}`, `{colors.ink-400}`; no orange or violet) used only when categories are
genuinely distinct; sequential teal ramp (`primary-subtle → primary-dark`) for heatmap/share; semantic green/amber/red **only** for
good/watch/bad and always paired with an icon or word; previous-period series = `ink-400` dashed; gridlines `border` at 1px, no vertical grid;
tooltip = one shared component (surface, `rounded-md`, shadow-md, label + value + delta rows) used by all charts.

**Motion budget (SUPERSEDED by design D13, see "Design review decisions": the table below is NOT the build target; the accepted set is 150-250ms; the tab indicator is a filled sliding pill, not an underline, design D7):**

| Moment | Motion | Timing |
|---|---|---|
| Page/tab enter | KPI cards stagger up 8px + fade | 40ms stagger, 240ms, `ease-out` |
| Tab switch | Shared-layout underline slides; panel crossfade, no layout jump | 200ms |
| Period/filter change | Old data dims to 60% (never blanks), new data crossfades; charts **update** (path morph), not remount | 250ms |
| KPI numbers | Count-up from previous value on change (not from 0 on every render) | 500ms, `easeOut` |
| Line/area | Stroke draws left→right once on first load only | 700ms |
| Bars / funnel | Grow from baseline, 30ms stagger | 400ms |
| Hover | Crosshair + point scale, tooltip follows with light spring; siblings dim 30% | instant → 120ms |
| Live widgets | 8px pulsing dot + "Updated Ns ago" ticks; value changes flash a 600ms tint | subtle |
| Export | Button → progress → check, toast with link | 200ms states |
| Reduced motion | No stagger/draw/count; opacity-only 100ms crossfade | — |

Rule: nothing animates on scroll, nothing loops except the live dot, and no animation delays access to data (numbers are readable at t=0).

## 7. Backend plan (what exists vs what's new)

Exists: `getDailyRevenue`, `getRideFunnel`, `getTopDrivers`, `getCityBreakdown`, `getCategoryBreakdown`, `getEtaAccuracy`,
`getDriverOnboardingFunnel`, `getDriverAvailability`. All take only `days` (7/30/90); every query is hard-wired to the trailing window.

Changes (verify each against the schema before building — I did not read the ledger/payout tables in this pass):
1. Replace `days` with `{from, to, cityIds?, categoryId?}` (Zod-validated; cap range at 366d). Add `compare=prev|yoy` computing the comparison window server-side and returning `{current, previous}` for every KPI.
2. New: `GET /analytics/kpis` (the 6 KPIs + sparklines), `GET /analytics/demand-heatmap` (hour x weekday, `AT TIME ZONE 'Asia/Kolkata'`), `GET /analytics/drivers/quality` (acceptance/completion/cancel/hours online — needs broadcast-offer data; **check whether offer accept/reject is stored**, else acceptance % is not computable), `GET /analytics/cancellations` (by reason/actor if stored), `GET /analytics/finance` (gross, commission, driver earnings, cash vs online, refunds, payouts from wallet ledger).
3. `GET /analytics/export/:tab.csv` streaming with the same filter schema; audit-log the export (admin-audit module exists) since it exposes financial data. Role-gate finance tab to `super_admin` + `finance_admin`.
4. Index review on `rides(created_at, status, origin_city_id)` before shipping wider ranges; cache summary per (filter hash) in Redis for 60s (Redis already in stack).
5. Timezone: bucket days in IST, not UTC — currently unverified, likely a bug at midnight boundaries.

Frontend structure (fixes finding 19): `analytics/page.tsx` shell + `components/reports/{FilterBar,KpiCard,TrendChart,FunnelChart,Heatmap,DriverQualityTable,ChartTooltip}.tsx` + `lib/reports-format.ts` + `lib/reports-api.ts`. Use `useQuery`-style per-widget fetch with independent error state (check if react-query is installed; otherwise a 20-line `useAsync` hook, no new dependency).

## 8. Delivery phases (each shippable alone, each ends with a verifiable check)

| Phase | Scope | Verify |
|---|---|---|
| **0 Bug fixes** (small) | Real error states instead of `EMPTY`; fix 768w chart collapse; hide zero-city rows; remove fake affordances; single page title; hide `Snapshots` nav or build it; 44px period buttons; ₹ compact axis + tooltip. | Component tests for error/empty; screenshot at 390/768/1440; kill API → error card, not zeros |
| **1 Foundations** | Filter bar with URL state, date range, city/category; KPI strip + deltas; comparison overlay; shared tooltip/format helpers; DESIGN.md data-viz + motion section. | API tests for range + compare math (incl. IST boundary); RTL tests for URL state |
| **2 Depth** | Tabs, true funnel, demand heatmap, driver quality table with drill-through, "Needs attention". | API tests per endpoint; manual seeded-data check of each number against a SQL count |
| **3 Finance + Export** | Revenue & Payouts tab, CSV export + audit log, role gating. | CSV totals reconcile to ledger for a fixed range; non-finance role gets 403 |
| **4 Motion pass** | Section 6 table, reduced-motion path, perf check (no chart remounts, INP < 200ms on filter change). | Screen recording; reduced-motion emulation; Lighthouse/INP |

Suggested order: 0 → 1 → 3 (finance is the largest unmet job) → 2 → 4. Roughly: human ~3-4 weeks; with CC ~1-2 days per phase.

## 9. Open decisions (need your call before implementation) — decisions 1, 2, 4, 5 RESOLVED by the design review: finance first (D11), remove Snapshots (D12), purposeful motion 150-250ms (D13), previous-period on/off comparison (D14)

1. **Who is Reports for first?** Ops health (Overview + Rides/Demand first) or Finance (Revenue & Payouts + CSV first). Recommendation: finance-first after Phase 0/1, because export is the largest missing capability.
2. **Snapshots nav item:** delete it, or is it a planned "saved report snapshots" feature? Recommendation: remove until designed.
3. **Acceptance % / cancellation reasons:** need offer-level data. Confirm whether `ride_broadcasts`-style offer outcomes are persisted; if not, either start recording them (Phase 2 backend work) or drop those columns.
4. **Scope of "premium":** full motion table in section 6, or the light version (tab underline + crossfade + count-up only). Recommendation: full table but behind one `motion.ts` config so it can be dialled back.
5. **Comparison default:** previous period (recommended) vs same period last year (Ocar too young for YoY).

## 10. Risks

- Wider date ranges + per-city filters can make the aggregate queries slow; mitigate with the index review and Redis cache before Phase 2.
- CSV export of financial data is a data-leak surface: role gate + audit log are not optional.
- Motion can become theatre. PRODUCT.md principle 2 ("speed is felt, not theatrical") is the test: any animation that delays reading a number gets cut.

---

# Engineering review (/plan-eng-review, 2026-09-29)

Target: this plan. Report file: this file. Evidence: `api/src/modules/analytics/*`, `007_m5_booking.sql`, `008_m6_payments.sql`, `064_cash_collection.sql`, `AdminSidebar.tsx`, `StatCard.tsx`.

## Factual corrections to the plan (no decision needed)

- Section 7 item 5 ("IST bucketing unverified, likely a bug") is **wrong**: daily revenue already buckets with `(r.requested_at AT TIME ZONE 'Asia/Kolkata')::date` (`analytics.repository.ts:33`). The real issues are the mixed time bases and rolling `NOW() - N days` windows (see R1).
- Section 9 decision 3 is **answered by the schema**: `ride_assignments` (status `offered/accepted/declined/expired/cancelled`, `offered_at`, `broadcast_round`, `007:241-251`) gives acceptance %; `ride_cancellations` (`actor`, `stage`, `reason_code`, `007:310-322`) gives the cancel breakdown. No new recording is required.
- Section 7 item 4: the existing `completed_at` index is partial (`WHERE cash_discrepancy = true`, `064:18-20`) and `rides_active_idx` is partial on active statuses (`007:187-189`). **No usable index exists for `requested_at` or `completed_at` range scans.**
- `payments.ride_id` is `UNIQUE` (`008:9`), so the "several payments per ride" double-count concern in `getCityBreakdown`'s comment cannot occur; its `DISTINCT` is defensive only.

## Scope Challenge record

feature answers: D1 needs-attention list = CUT; D2 utilisation / hours-online = CUT; structure: D3 = B Smaller arrangement (extend `StatCard` with an optional sparkline instead of a new `KpiCard`; reuse `FilterBar` and `MultiSelectFilter`; new endpoints inside the existing analytics module; keep only `ChartTooltip`, `reports-format` and chart/table components that do not exist; a regression test for `StatCard`'s existing props is part of this arrangement); accepted scope: plan as written minus the "Needs attention" list (section 4 Overview item 3) and minus hours-online/utilisation (section 4 Drivers); pending remedies: R1-R6.

## Decision ledger

### R1: Canonical time base for Reports money and completed-ride numbers
Finding: #1, P1, confidence 9, `analytics.repository.ts:33-41,75-88` (revenue/funnel/city/category use `requested_at`; top drivers uses `completed_at`; window is rolling `NOW() - N days`), reviewer: Claude.
Plan baseline: original proposal (plan section 7 item 5 assumed IST bucketing was the bug).
Runtime evidence: source read; not probed against seeded data.
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Clock for money and completed-ride counts | mixed (`requested_at` and `completed_at`) | keep mixed | `completed_at` | `payments.captured_at` |
| Clock for demand (requested, cancelled) | `requested_at` | `requested_at` | `requested_at` | `requested_at` |
| Date range semantics | rolling `NOW() - N days` | fixed by plan 7.1: IST-day `{from,to}` | same | same |

Question D4:
D4 — Which timestamp defines "the day" for Reports money and completed-ride numbers?
Project/branch/task: Reports redesign plan review on branch develop (finding 1, analytics.repository.ts:33-41 and 75-88).
ELI10: Today revenue is grouped by the day a ride was requested, while Top Drivers uses the day it completed. A ride requested at 11:50 pm and finished at 12:20 am lands on different days in different widgets, so totals across the page, and against payments, will not match. We need one rule for the new KPIs, trends and CSV export.
Stakes if we pick wrong: Finance exports that do not reconcile with what drivers were paid, and ops arguing over which number is right.
Recommendation: B because a fare is earned when the ride completes, so Overview, Drivers and Finance can all tie out; demand metrics (requested, cancelled) still belong to request time.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Keep the current mixed rules
  ✅ No query rewrites, and today's numbers stay identical to what ops has already seen.
  ❌ New KPIs, comparison periods and the CSV export inherit the mismatch, so totals will not tie out across tabs.
B) completed_at for money and completed rides, requested_at for demand (recommended)
  ✅ Revenue, commission, earnings and completed counts share one clock, so every tab and the CSV reconcile.
  ❌ Past daily revenue shifts for rides that cross midnight, and funnel and revenue intentionally use different clocks (explained in a tooltip). (human: ~0.5 day / CC: ~15 min)
C) payments.captured_at for money
  ✅ Ties exactly to when the payment was recorded, which is closest to what an accountant expects.
  ❌ Unverified: it is unknown whether cash payments set captured_at (an earlier bug filtered on a nonexistent 'captured' status, 093a2c0), so cash rides could be dropped.
Net: One consistent completion clock vs zero rewrite effort vs unverified payment-time accuracy.
Header: Time base
Options:
A) Keep mixed rules
Keep the current mixed clocks (requested_at for revenue, funnel, city and category; completed_at for top drivers). New KPIs and the CSV export inherit them. No query rewrites.
B) completed_at for money (recommended)
Use completed_at for revenue, commission, earnings and completed-ride counts; requested_at for requested, cancelled and demand metrics. Requires rewriting the 4 affected analytics queries and updating tests. Range indexes are a separate decision (R5).
C) payments.captured_at for money
Use payments.captured_at for money and completed_at for ride counts. Needs verification that cash payments set captured_at before it can be trusted; may drop cash rides until fixed.

State: approved
Actual answer: D4 = B "completed_at for money (recommended)"
Accepted scope: revenue, commission, earnings and completed-ride counts use `completed_at` (IST-day buckets, `{from,to}` ranges per plan 7.1); requested, cancelled and demand metrics use `requested_at`; rewrite the 3 affected analytics queries (`getDailyRevenue`, `getCityBreakdown`, `getCategoryBreakdown`; `getTopDrivers` is already on `completed_at` and only gets D5's filter) and their tests; tooltip explains the two clocks.
History: none

### R2: Filter Top Drivers earnings to completed payments
Finding: #3, P1, confidence 7, `analytics.repository.ts:86` (`LEFT JOIN payments p ON p.ride_id = r.id` with no status filter, unlike every other query), reviewer: Claude.
Plan baseline: original proposal (not mentioned in the plan).
Runtime evidence: source read; whether `driver_earning` is populated on non-completed payments is unknown (default `0.00`, `008:22`).
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| Payments counted in driver earnings | all statuses | `status = 'completed'` only | unchanged |
| Refunded / partially refunded payments | counted | excluded | counted |

Question D5:
D5 — Count only completed payments in Top Drivers earnings?
Project/branch/task: Reports redesign plan review on branch develop (finding 3, analytics.repository.ts:86).
ELI10: The Top Drivers query adds up driver earnings from every payment row for a ride, whatever its status. Every other report query only counts completed payments. If a failed, pending or refunded payment carries a driver_earning value, it would inflate that driver's total on the Reports page.
Stakes if we pick wrong: A driver appears to have earned money they were never paid, on the page finance uses to reconcile.
Recommendation: A because it makes Top Drivers consistent with every other query on the page and is a one-line filter.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Filter to completed payments (recommended)
  ✅ Matches the rest of the analytics module and removes any chance of unpaid earnings being counted.
  ❌ Refunded or partially refunded rides drop out of earnings entirely, which may or may not match how payouts treat them. (human: ~15 min / CC: ~3 min)
B) Leave as is
  ✅ No change; earnings stay as ops has seen them.
  ❌ The risk of counting failed, pending or refunded payments stays, and the new Finance tab would disagree with this table.
Net: Consistent, conservative earnings vs unchanged numbers that may overcount.
Header: Earnings filter
Options:
A) Filter to completed (recommended)
Add `AND p.status = 'completed'` to the payments join in getTopDrivers and a test with a failed and a completed payment. Refunded payments are excluded from earnings.
B) Leave as is
No change to getTopDrivers. Accept possible overcount of earnings from non-completed payments.

State: approved
Actual answer: D5 = A "Filter to completed (recommended)"
Accepted scope: add `AND p.status = 'completed'` to the payments join in `getTopDrivers`; add a test with one failed and one completed payment; refunded payments are excluded from earnings.
History: none

### R3: Who can see Reports
Finding: #4, P1, confidence 9, `AdminSidebar.tsx:77` (roles `super_admin`, `finance_admin`) vs `analytics.routes.ts:12` (`super_admin`, `ops_admin`, `finance_admin`), reviewer: Claude.
Plan baseline: original proposal (section 1 names an "Ops lead" persona; section 7.3 gates the Finance tab to `super_admin` and `finance_admin`).
Runtime evidence: source read only.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| ops_admin sees Reports in nav | no (API allows it) | no | yes |
| Finance tab and finance CSV | not built | super_admin + finance_admin | super_admin + finance_admin only, 403 for others |
| Overview, Rides & Demand, Drivers tabs | super_admin, finance_admin | same | plus ops_admin |
| Money KPIs shown to ops_admin | n/a | n/a | hidden |

Question D6:
D6 — Should ops admins be able to open Reports (without the Finance tab)?
Project/branch/task: Reports redesign plan review on branch develop (finding 4, AdminSidebar.tsx:77 vs analytics.routes.ts:12).
ELI10: The API already lets ops admins read analytics, but the sidebar hides the Reports link from them, so the people who most need ops metrics cannot reach the page. The plan's Finance tab must stay finance-only either way.
Stakes if we pick wrong: Ops keeps working without the page (or bypasses the nav with a typed URL), or ops sees money data it should not.
Recommendation: B because ops metrics (rides, demand, drivers) are their job and the API role check already allows it; only the Finance tab and its export need stricter access.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Keep Reports finance and super admin only
  ✅ No change; no chance of ops seeing revenue or commission figures.
  ❌ The Overview, Rides and Drivers tabs stay unreachable for the ops team the plan is written for, and the API and nav stay inconsistent.
B) Add ops_admin, hide Finance tab and gate its endpoints (recommended)
  ✅ Ops gets their metrics; the Finance tab and CSV return 403 for anyone but super_admin and finance_admin, enforced server-side. (human: ~0.5 day / CC: ~15 min)
  ❌ Revenue KPIs on Overview must be hidden per role, so the KPI strip needs a role-aware variant.
Net: Ops gets the page they need vs the simplest access model.
Header: Ops access
Options:
A) Keep as is
Reports nav stays super_admin and finance_admin only. ops_admin can still call the analytics API directly. No new role logic.
B) Add ops_admin (recommended)
Add ops_admin to the Reports nav; hide money KPIs and the Finance tab for ops_admin in the UI; enforce super_admin and finance_admin on finance endpoints and CSV export server-side; add a role test per endpoint.

State: approved
Actual answer: D6 = B "Add ops_admin (recommended)"
Accepted scope: add `ops_admin` to the Reports nav entry; hide money KPIs and the Finance tab for `ops_admin`; enforce `super_admin` + `finance_admin` on finance endpoints and CSV export server-side; role test per endpoint.
History: none

### R4: Connection isolation for analytics queries
Finding: #5, P1, confidence 8, `analytics.repository.ts:14` (each analytics query calls `pool.connect()`), `analytics.service.ts:9-16` (5 in parallel) plus onboarding and availability = 7 connections per page view; shared pool max 15 (`config/index.ts:28`); availability polls every 60 s, reviewer: Claude.
Plan baseline: original proposal (the plan adds compare windows, 4 tabs, heatmap and quality queries; section 10 mentions slow queries only).
Runtime evidence: source read; not load-tested.
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Analytics connections | shared pool, unbounded per page | unchanged | in-process cap of 3 concurrent queries | dedicated `analyticsPool`, max 4 |
| Isolation from ride and payment traffic | none | none | partial (still the shared pool) | full |
| Response caching | none | none | none | none (deferred, see NOT in scope) |

Question D7:
D7 — Keep analytics from starving ride and payment connections?
Project/branch/task: Reports redesign plan review on branch develop (finding 5, analytics.repository.ts:14, analytics.service.ts:9-16).
ELI10: Every report query takes its own database connection from the same pool of 15 that rides and payments use. One Reports page load already takes 7 at once, and each open tab adds one more every minute. The redesign adds comparison windows, tabs, a heatmap and quality tables, so a few admins opening Reports could leave riders waiting for a connection.
Stakes if we pick wrong: A busy Reports page slows or fails ride booking and payment writes, which is the core product.
Recommendation: C because a separate small pool gives real isolation with a few lines, and the per-query timeout wrapper already exists to build on.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) No change
  ✅ Zero work; fine while only a couple of admins use Reports.
  ❌ New tabs and comparison queries multiply connection use on the shared pool, with no protection for ride traffic.
B) In-process cap of 3 concurrent analytics queries
  ✅ Tiny change inside analyticsQuery; no new pool or config.
  ❌ Still uses the shared pool and is per server instance, so two instances during blue/green can still take 6 connections. (human: ~2h / CC: ~10 min)
C) Dedicated analytics pool, max 4 (recommended)
  ✅ Hard ceiling on analytics connections, isolated from the ride and payment pool; failures stay inside Reports. (human: ~3h / CC: ~15 min)
  ❌ Adds one more pool to configure, monitor (pg_pool_connections metric) and size against RDS max connections per instance.
Net: Fastest but unprotected vs a cheap cap vs true isolation at the cost of one more pool.
Header: Pool isolation
Options:
A) No change
Analytics keeps using the shared pool. Accept the connection load from the redesign.
B) In-process cap of 3
Add a small semaphore in analyticsQuery so at most 3 analytics queries hold a connection at once per server instance. Shared pool otherwise unchanged.
C) Dedicated pool, max 4 (recommended)
Create a separate `analyticsPool` (max 4, same statement-timeout wrapper) used only by analytics queries, expose it in the pg pool metrics, and add a test that analytics queries do not consume the main pool.

State: approved
Actual answer: D7 = C "Dedicated pool, max 4 (recommended)"
Accepted scope: separate `analyticsPool` (max 4, same per-query statement-timeout wrapper) used only by analytics queries, exposed in the pg pool metrics, with a test that analytics queries do not consume the main pool. Response caching stays out of scope (deferred).
History: none

### R5: Indexes for Reports range scans
Finding: #6, P2, confidence 8, `007:187-189` (`rides_active_idx` partial on active statuses), `064:18-20` (`completed_at` index partial on `cash_discrepancy = true`), reviewer: Claude.
Plan baseline: original proposal (section 7 item 4 says "index review before shipping wider ranges").
Runtime evidence: schema read; no EXPLAIN run.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| requested_at range scans (funnel, demand, cancellations) | sequential scan | unchanged | `rides (requested_at)` |
| completed_at range scans (money and completed counts, if R1 = B) | sequential scan | unchanged | `rides (completed_at) WHERE status = 'completed'` |
| Migration style | n/a | none | plain `CREATE INDEX` inside migrate.ts's transaction, per 057 precedent |

Question D8:
D8 — Add indexes for Reports date-range queries?
Project/branch/task: Reports redesign plan review on branch develop (finding 6; the second index depends on D4's answer).
ELI10: The rides table has no useful index for "rides in this date range". Every report scans the whole table, which is fine for a few thousand rides and gets slow as history grows, especially with the plan's 366-day ranges. Adding two indexes fixes that at a small cost on each ride write.
Stakes if we pick wrong: Reports queries hit the 60 s analytics timeout as data grows, or slow writes on the busiest table for no benefit.
Recommendation: B because plain index builds are cheap at current row counts (repo precedent 057), and retrofitting later means a locking migration on a bigger table.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Skip for now
  ✅ No migration and no write overhead on rides.
  ❌ Reports slow down as rides grow, and the later fix is a heavier, locking migration on a larger table.
B) Add both indexes now (recommended)
  ✅ Range queries stay fast; one plain migration and a small write cost. (human: ~2h / CC: ~10 min)
  ❌ Two extra indexes on the busiest table, and the plain CREATE INDEX briefly blocks ride writes while it builds.
Net: Future-proof read speed vs a small permanent write cost and a brief lock.
Header: Range indexes
Options:
A) Skip for now
No migration. Accept sequential scans until they are measured slow.
B) Add both indexes (recommended)
New migration adding `rides (requested_at)` and `rides (completed_at) WHERE status = 'completed'` using plain CREATE INDEX (repo precedent 057), plus an EXPLAIN check on a seeded range query.

State: approved
Actual answer: D8 = B "Add both indexes (recommended)"
Accepted scope: one migration adding `rides (requested_at)` and `rides (completed_at) WHERE status = 'completed'` with plain CREATE INDEX (057 precedent; migrate.ts wraps files in BEGIN/COMMIT so CONCURRENTLY is not possible); EXPLAIN check on a seeded range query.
History: none

### R6: "Total Revenue" label and commission KPI
Finding: #8, P2, confidence 9, `page.tsx:199-203` (label "Total Revenue" over `SUM(p.amount)`) vs `008:19-20` (`commission_amount`), reviewer: Claude.
Plan baseline: original proposal (section 4 already lists Gross bookings and Take rate KPIs; Phase 0 lists the ₹ compact axis but not the rename).
Runtime evidence: source read.
Comparison grid:

| Choice | Current | A | B |
|---|---|---|---|
| Label for `SUM(payments.amount)` | "Total Revenue" | "Gross bookings" | "Total Revenue" |
| Ocar earnings figure (commission) | absent | "Ocar revenue (commission)" KPI | absent |

Question D9:
D9 — Rename "Total Revenue" to "Gross bookings" and show commission as Ocar revenue?
Project/branch/task: Reports redesign plan review on branch develop (finding 8, page.tsx:199-203).
ELI10: The big number labelled "Total Revenue" is the sum of fares customers paid, most of which belongs to drivers. What Ocar earns is the commission on each payment (15% by default). Calling the fare total "revenue" can mislead the founder and finance.
Stakes if we pick wrong: Someone reads gross fares as company income when planning costs or payouts.
Recommendation: A because the label is a one-line change, the data (commission_amount) already exists, and the plan already lists Gross bookings and Take rate KPIs.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Rename and add the commission KPI (recommended)
  ✅ Numbers mean what their labels say, so finance and ops read the same words. (human: ~1h / CC: ~5 min)
  ❌ Anyone used to the old "Total Revenue" label has to learn the new wording.
B) Keep the current label
  ✅ Nothing changes for current users.
  ❌ The figure stays mislabelled, and the plan's take-rate KPI would sit beside a "revenue" number that is not revenue.
Net: Accurate wording with a small relearning cost vs an unchanged, misleading label.
Header: Revenue label
Options:
A) Rename + commission KPI (recommended)
Rename to "Gross bookings", add an "Ocar revenue (commission)" KPI from `SUM(commission_amount)` on completed payments, and use those names in tooltips, CSV headers and tests.
B) Keep label
Keep "Total Revenue" as the label for gross payment amount and do not add a commission KPI in Phase 0 (take rate stays a later KPI).

State: approved
Actual answer: D9 = A "Rename + commission KPI (recommended)"
Accepted scope: rename "Total Revenue" to "Gross bookings"; add "Ocar revenue (commission)" KPI from `SUM(commission_amount)` on completed payments; use these names in tooltips, CSV headers and tests.
History: none

### R7: Reports response caching (TODO proposal)
Finding: deferral from R4 (D7), P3, confidence 8, `analytics.repository.ts` (every view recomputes every aggregate), reviewer: Claude.
Plan baseline: R4 grid row "Response caching: none (deferred)".
Runtime evidence: not measured; no latency data.
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Response caching for summary and KPI endpoints | none | none, TODOS.md item only | none, no TODO | Redis cache, TTL 60 s, filter-hash key, built in Phase 1 |
| TODOS.md change | none | new `## Reports` section, P3 item | none | none |

Question D10:
D10 — Record "Reports response caching" as a TODO?
(Full brief as asked; options: A) Add to TODOS.md (recommended), B) Skip, C) Build it now.)
Header: Caching TODO

State: approved
Actual answer: D10 = C "Build it now"
Accepted scope: Redis response cache for the summary and KPI/Overview endpoints only, TTL 60 s, key = hash of `{from, to, cityIds, categoryId, compare}` **plus the caller's role class** (`finance` vs `ops`), because D6 makes the payload role-dependent (money KPIs hidden for `ops_admin`); the live availability endpoint is never cached; no manual invalidation (TTL only); the page shows "Updated Ns ago" from the cached payload's `generated_at`; tests: cache hit returns identical `generated_at`, `ops_admin` never receives a cached finance payload, cache-miss falls through when Redis is down. This supersedes R4's "caching deferred" grid row; D7's pool decision is unchanged. No TODOS.md change.
History: R4 grid listed "none (deferred, see NOT in scope)"; D10 answered after the D7 approval, as a separate choice, so both stand.

Approval readiness: PASS. Checked R1 (D4), R2 (D5), R3 (D6), R4 (D7), R5 (D8), R6 (D9), R7 (D10), plus scope answers D1, D2, D3; each cites its own actual answer.

Correction to D3's stakes (new evidence, approval unchanged): `StatCard` is used by six admin pages (`disputes`, `drivers`, `overview`, `rides`, `sos`, `vehicles`), not only Overview. The accepted change is additive (optional sparkline prop), so the approved regression test covers all existing props and is run against every caller's usage.

## Review findings

Confidence in brackets. All Scope-Challenge findings #1 to #8 are recorded above; findings resolved by a decision are marked with their answer.

### Architecture (3 issues)
- [P1] (confidence: 9/10) `analytics.repository.ts:33-41,75-88` mixed time bases, resolved by R1 (D4 = B).
- [P1] (confidence: 9/10) `AdminSidebar.tsx:77` vs `analytics.routes.ts:12` role mismatch, resolved by R3 (D6 = B).
- [P1] (confidence: 8/10) `analytics.repository.ts:14` + `config/index.ts:28` shared pool pressure, resolved by R4 (D7 = C).
- Failure mode for the new export path is covered under Failure modes below.

### Code quality (6 issues)
- [P1] (confidence: 7/10) `analytics.repository.ts:86` top-drivers payment join unfiltered, resolved by R2 (D5 = A).
- [P2] (confidence: 9/10) `StatCard.tsx` vs proposed `KpiCard` duplication, resolved by D3 = B.
- [P2] (confidence: 9/10) `page.tsx:199-203` "Total Revenue" mislabel, resolved by R6 (D9 = A).
- [P2] (confidence: 8/10) `analytics.routes.ts:12-60` the period parsing block (`VALID_PERIODS[periodKey]`, 400 on invalid) is repeated per handler. Approved work already replaces `days` with one Zod `{from,to,cityIds,categoryId,compare}` schema (plan 7.1); it must be shared by every analytics route including the old `/summary` and `/eta-accuracy`, not added beside them.
- [P2] (confidence: 9/10) `page.tsx:144-152,159-163` `loadAvailability` calls `setAvailabilityLoading(true)` on every 60 s poll, so the availability table flips to skeleton rows once a minute. Approved plan section 5 ("stale: Updated Ns ago") requires the poll to keep showing the previous rows and update in place.
- [P3] (confidence: 8/10) `lib/colors.ts:12` `COLORS.border` is `#E2E8F0` while `DESIGN.md` defines border `#DCEBEE`; chart gridlines will not match cards. No remedy proposed here; reconcile inside the plan's Phase 1 data-viz token work.

### Test review
See the coverage diagram below: 28 paths, 4 tested, 24 gaps.

### Performance (1 issue)
- [P2] (confidence: 8/10) no usable range index on `rides`, resolved by R5 (D8 = B). Compare mode doubles range scans per view (two windows); compute both windows in one query with `FILTER` clauses rather than two round trips (implementation note for the approved compare behavior).

## Test coverage diagram

```
CODE PATHS                                                   USER FLOWS
[+] api/src/modules/analytics (R1 rewrite + new)             [+] Reports page
  ├── getDailyRevenue                                          ├── [GAP] Change range keeps old data visible
  │   ├── [★★ TESTED] revenue delta — m12.test.ts:69-79        │       until new data lands (no blanking)
  │   └── [GAP] ride crossing IST midnight, completed_at       ├── [GAP] Export CSV click -> download -> toast
  ├── getRideFunnel                                            │       [→E2E] (no E2E framework in admin;
  │   ├── [★★ TESTED] requested/completed — m12:69-70          │       covered by QA test-plan artifact)
  │   └── [GAP] accepted-then-cancelled counted as accepted    └── [GAP] 768px: charts render bars (finding #2)
  ├── getTopDrivers                                                    manual QA (no layout tests in jsdom)
  │   ├── [GAP] happy path (no test at all today)
  │   └── [GAP] failed + completed payment (D5)                [+] Frontend states
  ├── getCityBreakdown                                           ├── [GAP] StatCard existing props, 6 callers (D3)
  │   ├── [★★ TESTED] ride_count/revenue — m12:86-88           ├── [GAP] API 500 -> error card, not zeros  ← CRITICAL
  │   └── [GAP] zero-denominator cancellation rate             ├── [GAP] one-point chart low-data state
  ├── getCategoryBreakdown                                     ├── [GAP] filter state in URL, back/forward
  │   └── [GAP] no test                                        ├── [GAP] ops_admin: money KPIs + Finance hidden
  ├── getDriverAvailability                                    └── [GAP] availability poll: no skeleton flash
  │   └── [★★ TESTED] online count — m12:12-17
  ├── KPIs + compare windows                                 REGRESSION (IRON RULE): m12 revenue/city
  │   └── [GAP] IST-day boundaries, empty previous -> null     assertions change with R1 (completed_at);
  ├── drivers/quality (ride_assignments)                       update them in the same PR.
  │   └── [GAP] declined/expired/no offers, 0 of 0
  ├── demand heatmap
  │   └── [GAP] IST hour/weekday bucketing
  ├── cancellations by reason_code
  │   └── [GAP] actor/stage grouping, NULL reason_code
  ├── finance + CSV export
  │   ├── [GAP] totals reconcile to ledger for a fixed range
  │   ├── [GAP] 403 per role per endpoint (D6)
  │   └── [GAP] admin-audit row written on export
  ├── Redis response cache (D10)
  │   └── [GAP] role-class key, generated_at, Redis-down fallthrough
  ├── analyticsPool isolation (D7)
  │   └── [GAP] does not consume the main pool
  └── range Zod schema
      └── [GAP] from > to, > 366 days, bad cityIds

COVERAGE: 4/28 paths tested (14%)  |  Code paths: 4/19 (21%)  |  User flows + UI states: 0/9 (0%)
QUALITY: ★★★:0 ★★:4 ★:0  |  GAPS: 24 (1 needs E2E, 0 need eval)
Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke | [→E2E] needs integration test
```

Test framework: Vitest in `api` (integration tests need `TEST_DATABASE_URL`, per CLAUDE.md) and `apps/admin` (needs `vitest.react-pin.cjs`, learning `admin-vitest-dual-react-pin`). No LLM/prompt changes, so no eval scope. All 24 gap tests belong to accepted behavior (D3 to D10 and the approved plan) and are carried into the tasks below; no new test-depth policy was proposed, so no separate test decision was needed.

## NOT in scope
- "Needs attention" auto-alert list (D1 cut): needs threshold policy nobody has defined.
- Driver hours-online and utilisation (D2 cut): session-duration edge cases; live availability table remains.
- Scheduled email reports, report builder, PDF export, saved views, cohort retention (plan section 4).
- YoY comparison (plan open decision 5, recommended previous period only).
- Manual cache invalidation (D10: TTL only).
- A real `payments.captured_at` finance clock (D4 option C): unverified for cash payments.
- Alternative charting library; recharts stays.

## What already exists
- `analyticsQuery` helper with per-query `SET LOCAL statement_timeout` (`analytics.repository.ts:11-26`): reuse for the new endpoints, pointed at the new `analyticsPool` (D7).
- `ride_assignments` and `ride_cancellations`: acceptance % and cancel breakdown need no new data capture.
- `payments.commission_amount`, `driver_earning`, `channel`: commission KPI and cash-vs-online split.
- `StatCard` (count-up, delta), `FilterBar`, `MultiSelectFilter`, `DataTable`, `StatusPill`, `SlideOver`: reused per D3 = B.
- `admin-audit` module for the export audit row; Redis client (`api/src/db/redis.ts`) for D10; recharts and framer-motion already installed.
- `/analytics/eta-accuracy` endpoint: exists, unused; the Rides & Demand tab consumes it, no new query.
- The Vehicles page tab pattern is local `useState` (`vehicles/page.tsx:110-121`): Reports tabs use URL state instead, so this is a small new pattern, not a shared-component extraction.

## Diagrams

```
Browser (Reports, URL = tab/range/city/cmp)
   |  GET /admin/analytics/{kpis,summary,drivers/quality,...}?from&to&city&cmp
   v
Express route -> Zod range schema -> requireAdmin(role)      (D6: finance tab = super/finance only)
   v
service -> Redis cache? key = hash(filters) + roleClass        (D10, TTL 60s, availability never cached)
   |miss                       |hit -> payload + generated_at
   v
repository -> analyticsPool (max 4, statement_timeout 60s)    (D7)
   v
Postgres: rides(requested_at|completed_at idx), payments(completed), ride_assignments, ride_cancellations
   v
CSV export: same filters -> stream -> admin-audit row -> download
```

## Failure modes

| New path | Realistic failure | Test? | Handling | User sees |
|---|---|---|---|---|
| analytics endpoints | DB timeout at 60 s on a 366-day range | planned (range schema + EXPLAIN) | per-widget error card with Retry | clear error |
| existing page today | API 500 or network error | none (gap) | `catch { setData(EMPTY) }` (`page.tsx:126-128`) | **silent zeros, looks like a quiet month** |
| analyticsPool | pool saturated by 4 slow queries | planned (isolation test) | request waits up to `connectionTimeoutMillis`, then 5xx to Reports only | error card, rides unaffected |
| Redis cache | Redis down | planned (fall-through test) | bypass cache, query directly | slower load, correct data |
| Redis cache | ops_admin served a finance-keyed payload | planned (role-class key test) | key includes role class | n/a |
| CSV export | large range exceeds memory | none | stream rows, cap range at 366 days (plan) | download or error toast |
| CSV export | export written without audit row | planned | audit write before response ends | n/a |
| index migration | plain `CREATE INDEX` blocks ride writes briefly | EXPLAIN check | run in a quiet window (057 precedent) | none |

**Critical gap (1):** the existing page's `catch { setData(EMPTY) }` renders an API failure as empty data with no test and no visible error. The approved plan (section 5 states, Phase 0) fixes it; it stays flagged until that task ships.

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~2h / CC: ~15min)** — analytics UI — replace `catch { setData(EMPTY) }` with per-widget error state + Retry; stop the 60 s poll from resetting to skeleton
  - Surfaced by: Failure modes critical gap; Code quality (`page.tsx:126-128,144-152`)
  - Files: `apps/admin/app/(dashboard)/analytics/page.tsx`
  - Verify: `cd apps/admin && pnpm test` (new RTL tests: 500 shows error card; poll keeps rows); kill API, confirm error card
- [ ] **T2 (P1, human: ~0.5d / CC: ~20min)** — analytics API — R1 rewrite of revenue/commission/earnings/completed counts on `completed_at`, IST-day `{from,to}` ranges via one shared Zod schema; update m12 assertions
  - Surfaced by: Architecture #1 (D4), Code quality period-parsing duplication
  - Files: `api/src/modules/analytics/analytics.{routes,service,repository,types}.ts`, `api/tests/integration/m12.test.ts`
  - Verify: `cd api && pnpm test m12` with `TEST_DATABASE_URL`; midnight-crossing ride lands on completion day
- [ ] **T3 (P1, human: ~15min / CC: ~5min)** — analytics API — `AND p.status = 'completed'` in `getTopDrivers` + failed/completed payment test
  - Surfaced by: Code quality #3 (D5)
  - Files: `analytics.repository.ts`, `api/tests/integration/m12.test.ts` (or new `analytics.test.ts`)
  - Verify: test with one failed and one completed payment shows only the completed earning
- [ ] **T4 (P1, human: ~3h / CC: ~15min)** — API infra — dedicated `analyticsPool` (max 4) + pool metrics + isolation test
  - Surfaced by: Architecture #5 (D7)
  - Files: `api/src/db/client.ts`, `analytics.repository.ts`, `api/src/observability/metrics.ts`, `api/src/config/index.ts`
  - Verify: unit test that analytics queries do not touch the main pool; `pg_pool_connections` shows both pools
- [ ] **T5 (P1, human: ~0.5d / CC: ~15min)** — roles — add `ops_admin` to Reports nav, hide money KPIs/Finance tab for ops, gate finance endpoints and CSV to super/finance, role test per endpoint
  - Surfaced by: Architecture #4 (D6)
  - Files: `apps/admin/components/layout/AdminSidebar.tsx`, `analytics.routes.ts`, Reports page/tabs, `api/tests/integration/`
  - Verify: ops token gets 403 on `/analytics/finance*`; ops UI has no Finance tab
- [ ] **T6 (P2, human: ~2h / CC: ~10min)** — DB — migration adding `rides (requested_at)` and `rides (completed_at) WHERE status = 'completed'` (plain CREATE INDEX, 057 precedent)
  - Surfaced by: Performance #6 (D8)
  - Files: `api/src/db/migrations/<next>_rides_reporting_indexes.sql`
  - Verify: `pnpm migrate`; `EXPLAIN` on a seeded 90-day range shows index scans
- [ ] **T7 (P2, human: ~1h / CC: ~5min)** — copy — rename "Total Revenue" to "Gross bookings", add "Ocar revenue (commission)" KPI, use in tooltips/CSV headers
  - Surfaced by: Code quality #8 (D9)
  - Files: Reports page, analytics types/repository
  - Verify: KPI equals `SUM(commission_amount)` for completed payments in a fixed range
- [ ] **T8 (P2, human: ~0.5d / CC: ~20min)** — shared UI — extend `StatCard` with optional sparkline slot; regression test for all existing props used by 6 callers; reuse `FilterBar`/`MultiSelectFilter`
  - Surfaced by: Code quality (D3 = B), D3 correction
  - Files: `apps/admin/components/ui/StatCard.tsx`, `apps/admin/components/__tests__/StatCard.test.tsx`
  - Verify: `cd apps/admin && pnpm test`; open Overview, Drivers, Rides, SOS, Disputes, Vehicles unchanged
- [ ] **T9 (P2, human: ~1d / CC: ~30min)** — analytics API — Redis response cache (60 s, filter-hash + role-class key, `generated_at`, availability excluded) with the three cache tests
  - Surfaced by: TODOS proposal (D10 = Build it now)
  - Files: `analytics.service.ts`, `api/src/db/redis.ts` usage
  - Verify: hit returns same `generated_at`; ops never gets finance payload; Redis down falls through
- [ ] **T10 (P2, human: ~2d / CC: ~1h)** — new endpoints and tabs from the approved plan — KPIs + compare (one query, `FILTER` windows), drivers/quality via `ride_assignments`, cancellations via `ride_cancellations`, heatmap, finance + CSV export with `admin-audit` row
  - Surfaced by: plan sections 4 and 7 (approved scope minus D1/D2 cuts); Test review gaps 11-17
  - Files: `api/src/modules/analytics/*`, `apps/admin/app/(dashboard)/analytics/*`, `apps/admin/lib/admin-api.ts`
  - Verify: the 15 API/UI tests in the coverage diagram pass; CSV totals equal ledger sums
- [ ] **T11 (P3, human: ~1h / CC: ~5min)** — tokens — reconcile `COLORS.border` (`#E2E8F0`) with `DESIGN.md` `#DCEBEE` during the data-viz token work
  - Surfaced by: Code quality (`lib/colors.ts:12`)
  - Files: `apps/admin/lib/colors.ts`, `tailwind.config.ts`
  - Verify: chart gridlines match card borders visually at 1440 and 768

## Worktree parallelization strategy

| Step | Modules touched | Depends on |
|---|---|---|
| T2, T3, T7 (query + label changes) | `api/src/modules/analytics/` | none |
| T4 pool | `api/src/db/`, `api/src/observability/` | none |
| T6 index migration | `api/src/db/migrations/` | none (columns fixed by eng D4); must land before T12 merges |
| T8 StatCard + regression | `apps/admin/components/` | none |
| T1 error/poll states | `apps/admin/app/(dashboard)/analytics/` | none |
| T5 roles | `apps/admin/components/layout/`, `api/src/modules/analytics/` | T2 |
| T9 cache | `api/src/modules/analytics/` | T2, T5 (role-class key) |
| T10 new endpoints and tabs | `api/src/modules/analytics/`, `apps/admin/app/(dashboard)/analytics/` | T2, T4, T5, T8 |

Lane A: T2 -> T3 -> T7 -> T5 -> T9 -> T10 (shared `analytics/` module, sequential)
Lane B: T4 -> T6 (`db/`, independent of A until T10)
Lane C: T8 (`components/ui`, independent)
Lane D: T1 (Reports page, independent of A; merge before T10 touches the same page)

Execution order: launch A + B + C + D in parallel worktrees. Merge B, C, D, then A's T10 last. Conflict flags: T1 and T10 both edit the Reports page and A owns `analytics/` API files, so T1 merges before T10 rebases. T4 (pool) is imported by lane A's queries; land it before T10.

## Unresolved decisions
This review left these unanswered; they are product decisions from the plan's section 9 that the engineering review did not own:
- Plan section 9 decision 1: who is Reports for first (ops health vs finance). Affects lane order only (finance-first recommended).
- Plan section 9 decision 2: delete the Snapshots nav item (no page exists) or keep it as a planned feature.
- Plan section 9 decision 4: scope of the motion pass (full table vs light).
- Plan section 9 decision 5: comparison default (previous period recommended vs same period last year).

## Completion summary
- Step 0: Scope Challenge: scope reduced per recommendation (2 cuts, smaller structure)
- Architecture Review: 3 issues found
- Code Quality Review: 6 issues found
- Test Review: diagram produced, 24 gaps identified
- Performance Review: 1 issue found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 1 item proposed to user (answered: build now, no TODOS.md entry)
- Failure modes: 1 critical gap flagged
- Unresolved decisions: 4 in this review
- Outside voice: codex, unavailable (CLI exited 1 with no review; native fallback unavailable, TaskOutput not in this session); missing coverage, not a clean review
- Parallelization: 4 lanes, 3 parallel / 1 sequential merge tail
- Lake Score: 0/0 (no coverage-scored choices; all 10 answers were kind choices), N/A

# CEO review (/plan-ceo-review, 2026-09-29)

Mode: SELECTIVE EXPANSION (actual answer: CEO D1 = "Selective Expansion (recommended)"). Governing approved decisions: eng-review D1 to D10 (rows R1 to R7 above), unchanged.
Premise: the direct pain is trust in the numbers (gross fares labelled revenue, API failure shown as zeros, ops locked out, three revenue clocks). Tabs, heatmap and motion are proxies for "premium". Do-nothing cost: finance and the founder keep reading misleading figures.
HOLD checks (part of SELECTIVE): complexity check, about 12 files after eng D3, stands as approved; no new deferral proposed; invariants kept: no cut to the accepted finance export or role gating.

## CEO decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| E1 (Section 5 code quality / scope) | Overview revenue = `SUM(payments.amount)` by `payments.created_at` (`admin.repository.ts:2533-2534`); Reports per eng D4 = `completed_at` | not in plan | shared KPI definitions module used by Overview and Reports | approved | CEO D2 = Add to scope |
| E2 (scope) | `notifyAllAdmins()` persists feed row + push + socket (`notifications.service.ts`); BullMQ queues exist (`jobs/queues`) | not in plan | daily 9:00 IST admin digest of yesterday's KPIs | approved | CEO D3 = Add to scope; role scope re-approved by CEO D6 (E2b) |
| E3 (scope) | `rides.cash_collected_amount`, `cash_collected_at`, `cash_discrepancy` (`064_cash_collection.sql:10-20`) | not in plan | cash discrepancy panel on the Finance tab | approved | CEO D4 = Add to scope |
| E4 (scope) | `refunds` (`008_m6_payments.sql:93`), `disputes` (`009_m7_safety.sql:99`) | not in plan | refund and dispute rate KPIs | approved (build-gated) | CEO D5 = Add to scope |
| E5 (spec review) | ops_admin money via API | returned | server-side strip | approved | CEO D8 = Strip money server-side |
| E6 (Section 3) | CSV formula injection | as-is | neutralise | approved | CEO D10 = Neutralise formula cells |
| E7 (Section 8) | no metrics or alert for digest/cache/export | none | minimal observability | approved | CEO D11 = Add minimal observability |

CEO approval readiness: PASS. Checked E1 (D2), E2 (D3, D6), E3 (D4), E4 (D5), E5 (D8), E6 (D10), E7 (D11), plus mode (D1) and document approval (D7, D9); each accepted remedy cites its own actual answer. Not approved and left pending: export rate limiting (Section 3), plan section 9 decisions 1, 2, 4, 5.

### currentDecision (E1)
Commitment comparison:

| Commitment | Source or pending | Current | A Add | B Defer | C Skip |
|---|---|---|---|---|---|
| Overview and Reports read revenue/completed/cancel definitions from one module | pending | two separate SQL implementations | one shared module | unchanged, TODO added | unchanged |
| Overview "revenue today" clock | pending | `payments.created_at` | `completed_at` (same as Reports, eng D4) | `payments.created_at` | `payments.created_at` |
| Agreement test between Overview and Reports for a fixed day | pending | none | included | none | none |
| TODOS.md change | pending | none | none | new Reports item | none |

Question: D2 — E1: Share one set of revenue and ride definitions between Overview and Reports?
Project/branch/task: Reports redesign plan on branch develop (CEO review, Selective Expansion; evidence admin.repository.ts:2533-2534 vs eng decision D4).
ELI10: The Overview page counts today's revenue by the moment a payment row was created. The redesigned Reports page will count it by when the ride completed. So the founder can see one number on Overview and a different one on Reports for the same day. Writing the definitions once and using them in both places keeps the two pages saying the same thing.
Stakes if we pick wrong: Two pages disagree on the most-watched number and people stop trusting either.
Recommendation: A because trust is the core problem this plan exists to fix, and the shared module is small compared with the eng-approved rewrites already touching the same queries.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Add to this plan's scope (recommended)
  ✅ Overview and Reports show the same revenue, completed and cancel numbers, proved by an agreement test. (human: ~1 day / CC: ~30 min)
  ❌ Overview's "revenue today" changes for rides that cross midnight, and the change touches the admin dashboard query that ops already watches.
B) Defer to TODOS.md
  ✅ Keeps this plan's scope as approved and records the mismatch and its evidence for later.
  ❌ The mismatch ships: Overview and Reports disagree from day one.
C) Skip
  ✅ No extra work and no change to the Overview page.
  ❌ Nothing tracks the mismatch, and it will surface as a finance complaint.
Net: One source of truth with a small Overview change vs shipping two disagreeing pages.
Header: Shared KPIs
A) Add to scope (recommended)
Create one shared definitions module (gross bookings, commission, completed rides, cancellation rate on the eng-D4 clocks) used by getAdminDashboardStats and the Reports queries, plus a test that Overview and Reports agree for a fixed day. Effort M, risk medium (Overview number shifts for midnight-crossing rides), reuses the eng D4 and D5 changes, verified by the agreement test.
B) Defer to TODOS.md
Add a P2 TODO under a new Reports section with the evidence (`admin.repository.ts:2533-2534`) and add it to NOT in scope. Effort S, risk low, no change to Overview now.
C) Skip
Reject the extra work and record it under NOT in scope with no TODO. Effort S, risk low, the mismatch stays.

State: approved
Actual answer: CEO D2 = "Add to scope (recommended)"
Accepted scope: one shared definitions module (gross bookings, commission, completed rides, cancellation rate on the eng-D4 clocks) used by `getAdminDashboardStats` and the Reports queries; Overview "revenue today" moves from `payments.created_at` to `completed_at`; test that Overview and Reports agree for a fixed day; regression test on the existing Overview stats fields.

### currentDecision (E2)
Commitment comparison:

| Commitment | Source or pending | Current | A Add | B Defer | C Skip |
|---|---|---|---|---|---|
| Daily admin digest | pending | none | 9:00 IST BullMQ repeatable job, in-app + push via `notifyAllAdmins()` | none, TODO added | none |
| Channel | pending | n/a | in-app feed + push only (no SMS, no email) | n/a | n/a |
| Content | pending | n/a | yesterday's 5 KPIs from the shared definitions | n/a | n/a |
| Money in digest for ops_admin | pending | n/a | hidden (eng D6 role rule) | n/a | n/a |

Question: D3 — E2: Send a daily digest of yesterday's numbers to admins?
Project/branch/task: Reports redesign plan on branch develop (CEO review; reuses notifyAllAdmins and BullMQ).
ELI10: Right now an admin has to open Reports to learn how yesterday went. A small daily notification at 9 am IST (rides, completion and cancel rate, gross bookings, commission) puts the answer in front of the founder and ops without them asking. It reuses the notification and job systems that already exist.
Stakes if we pick wrong: Build it and nobody reads it, or skip it and the page still requires a visit to know if something broke overnight.
Recommendation: B because it is a real leverage idea but depends on the shared KPI definitions (E1) and on whether admins actually want push at 9 am, which we cannot know yet.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Add to this plan's scope
  ✅ Ops and the founder see yesterday's numbers without opening the page; uses existing notification and BullMQ code. (human: ~1.5 days / CC: ~40 min)
  ❌ Adds a scheduled job, timezone handling and role-aware content that must be tested and monitored.
B) Defer to TODOS.md (recommended)
  ✅ Keeps scope as approved and records the idea with its dependencies (E1, eng D6) and trigger.
  ❌ Nothing is delivered proactively until it is built.
C) Skip
  ✅ No scheduled job to maintain.
  ❌ The overnight-broke case still needs someone to open Reports.
Net: Proactive numbers vs a bigger build before anyone has asked for them.
Header: Daily digest
A) Add to scope
Add a BullMQ repeatable job at 09:00 Asia/Kolkata that calls notifyAllAdmins() with yesterday's KPIs (money hidden for ops_admin), plus tests for the schedule, role content and empty-day copy. Effort M, risk medium (scheduled job, timezone), reuses notifications.service and jobs/queues.
B) Defer to TODOS.md (recommended)
Add a P3 TODO with dependencies E1 and eng D6 and the trigger "founder asks for proactive numbers", and list it under NOT in scope. Effort S, risk low.
C) Skip
Reject the digest and record it under NOT in scope with no TODO. Effort S, risk low.

State: approved
Actual answer: CEO D3 = "Add to scope"
Accepted scope: BullMQ repeatable job at 09:00 Asia/Kolkata calling `notifyAllAdmins()` with yesterday's KPIs from the E1 shared definitions (in-app feed + push only; no SMS, no email); money figures omitted for `ops_admin` per eng D6; tests for schedule/timezone, role-specific content and empty-day copy. Depends on E1.

### currentDecision (E3)
Commitment comparison:

| Commitment | Source or pending | Current | A Add | B Defer | C Skip |
|---|---|---|---|---|---|
| Cash discrepancy panel on Finance tab | pending | none | count and amount of rides with `cash_discrepancy = true` in range, link to the existing rides review queue | none, TODO added | none |
| New table or column | pending | none | none (columns exist) | none | none |
| Role access | pending | n/a | Finance tab roles only (eng D6) | n/a | n/a |

Question: D4 — E3: Show cash discrepancies on the Finance tab?
Project/branch/task: Reports redesign plan on branch develop (CEO review; evidence 064_cash_collection.sql:10-20).
ELI10: Many rides in Odisha are paid in cash. When the driver's collected amount does not match the fare, the ride is already flagged in the database for ops review. Showing how many flagged rides there are, and how much money is involved, on the Finance tab lets finance see cash risk next to the revenue numbers.
Stakes if we pick wrong: Cash leakage stays visible only to whoever opens the ops review queue.
Recommendation: A because the data and index already exist, it is one small query, and it fits the Finance tab's purpose of reconciling money.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Add to this plan's scope (recommended)
  ✅ Finance sees cash mismatches beside revenue with no new data capture. (human: ~3h / CC: ~15 min)
  ❌ One more query and panel on the Finance tab to test and keep in sync with the review queue's definition.
B) Defer to TODOS.md
  ✅ Keeps scope as approved and records the idea.
  ❌ Finance keeps reconciling cash outside Reports.
C) Skip
  ✅ No new panel.
  ❌ Cash risk is not visible on the page finance uses.
Net: A small, data-ready panel vs one more thing to maintain.
Header: Cash panel
A) Add to scope (recommended)
Add a Finance-tab panel: count and total (cash_collected_amount vs fare) of rides with cash_discrepancy = true in the range, linking to the existing rides review queue, with a fixture-based test. Effort S, risk low, reuses rides columns and the partial index.
B) Defer to TODOS.md
Add a P3 TODO and list it under NOT in scope. Effort S, risk low.
C) Skip
Reject and list under NOT in scope with no TODO. Effort S, risk low.

State: approved
Actual answer: CEO D4 = "Add to scope (recommended)"
Accepted scope: Finance-tab panel showing count and totals of rides with `cash_discrepancy = true` (collected vs fare) for the selected range, linking to the existing rides review queue; Finance roles only (eng D6); fixture-based test.

### currentDecision (E4)
Commitment comparison:

| Commitment | Source or pending | Current | A Add | B Defer | C Skip |
|---|---|---|---|---|---|
| Refund and dispute rate KPIs | pending | none | refunds per 100 completed rides and disputes per 100 completed rides, with amounts | none, TODO added | none |
| Refund status set counted | pending | unknown (refund_status enum not read) | to be confirmed from `002_enums.sql` before build | n/a | n/a |
| Placement | pending | n/a | Finance tab and Overview KPI strip | n/a | n/a |

Question: D5 — E4: Add refund and dispute rates to Reports?
Project/branch/task: Reports redesign plan on branch develop (CEO review; evidence 008_m6_payments.sql:93, 009_m7_safety.sql:99).
ELI10: Refunds and disputes are early warnings that rides or payments are going wrong. Two small rates (per 100 completed rides) next to the revenue numbers tell finance and ops whether quality or payments are slipping. The tables already exist; what is not yet confirmed is which refund statuses count.
Stakes if we pick wrong: Payment or quality problems show up as complaints before they show up on any chart.
Recommendation: B because the refund status set is unverified, and counting the wrong statuses would put a wrong number on the trust page.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Add to this plan's scope
  ✅ Early-warning signal for payments and service quality next to revenue. (human: ~0.5 day / CC: ~20 min)
  ❌ Requires confirming refund and dispute status semantics first; a wrong definition puts a wrong number on the page.
B) Defer to TODOS.md (recommended)
  ✅ Keeps scope as approved and records the idea with the "confirm status semantics" prerequisite.
  ❌ No refund or dispute signal on Reports until it is built.
C) Skip
  ✅ No extra KPIs on an already dense page.
  ❌ Refund and dispute spikes stay in their own pages only.
Net: Early warning vs risk of a mis-defined number before its semantics are confirmed.
Header: Refund rates
A) Add to scope
Add refund and dispute rate KPIs (per 100 completed rides) to Finance and Overview after confirming refund_status and dispute status semantics, with tests for each status. Effort S, risk medium (definition risk), reuses refunds and disputes tables.
B) Defer to TODOS.md (recommended)
Add a P3 TODO with the prerequisite "confirm refund/dispute status semantics" and list under NOT in scope. Effort S, risk low.
C) Skip
Reject and list under NOT in scope with no TODO. Effort S, risk low.

State: approved
Actual answer: CEO D5 = "Add to scope"
Accepted scope: refund rate and dispute rate KPIs per 100 completed rides on Finance and Overview. Prerequisite checked against schema: `refund_status` = requested/approved/processing/completed/failed (`002_enums.sql:99`), `dispute_status` = open/under_review/pending_info/resolved/escalated/withdrawn (`002_enums.sql:125`). Working definitions (finance to confirm during build): refunds count `status = 'completed'` by `processed_at`; disputes count every status except `withdrawn` by `created_at`; tests for each status value.

## CEO temporal interrogation (0I)

- Hour 1 (foundations): implementer needs the eng D4 clock rules and the E1 shared module first; every other task reads from it. Order the E1 module before T2/T10.
- Hours 2-3 (core logic): ambiguity to expect: "completed ride" for a ride with no completed payment (cash not yet confirmed); decide in the shared module and test it.
- Hours 4-5 (integration): surprise: the Overview number changes (E1) and the D10 cache role-class key must include the E2 digest path (digest bypasses cache, reads definitions directly).
- Hour 6+ (polish/tests): will wish for: the agreement test (Overview vs Reports), the digest empty-day copy, the refund status tests, reduced-motion checks.
- Effort for accepted expansions: E1 human ~1 day / CC ~30 min; E2 ~1.5 days / ~40 min; E3 ~3h / ~15 min; E4 ~0.5 day / ~20 min.

### currentDecision (E2b, reopens E2)
Reason for reopening: new evidence. `notifyAllAdmins()` (`notifications.service.ts:111-130`) takes `{type,title,body,payload,rideId}` and sends identical content to every admin id (`getAllAdminIds`, `notifications.repository.ts:218`) and every admin device token (`getAdminTokens`, `:211`). CEO D3's accepted scope ("money figures omitted for ops_admin") cannot be met through it. Prior answer: CEO D3 = "Add to scope"; prior history kept above.
Commitment comparison:

| Commitment | Source or pending | Current (approved E2) | A Same content to all admins | B Role-scoped notifier |
|---|---|---|---|---|
| Digest recipients | pending | all admins (implied by notifyAllAdmins) | all admins | all admins, content per role |
| Digest KPIs | approved E2 (five) | five, money hidden for ops | the ops-safe three (rides completed, completion rate, cancellation rate) for everyone | five for `super_admin` and `finance_admin`, three for `ops_admin` |
| Change to shared notifier | pending | none | none | add optional `roles` filter to `getAllAdminIds` / `getAdminTokens` (join `admins.role`), used by the digest only |
| Money in a push notification | eng D6 rule | hidden from ops | hidden from everyone | visible only to finance and super admins |

Question: D6 — E2b: How should the daily digest handle different admin roles?
Project/branch/task: Reports redesign plan on branch develop (CEO review; evidence notifications.service.ts:111-130, notifications.repository.ts:211-219).
ELI10: You approved a daily 9 am digest where ops admins see rides and rates but not money. The existing "notify all admins" function cannot do that: it sends the same text and the same push to every admin. So either everyone gets the money-free version, or we add a small role filter to the notifier so finance and the founder get the full five numbers.
Stakes if we pick wrong: Ops admins see revenue in their pocket, or the founder and finance never get revenue numbers in the digest.
Recommendation: B because the digest exists to give the founder and finance their numbers, and an optional role filter is a small, testable change that keeps the D6 money rule.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Same money-free digest for everyone
  ✅ No change to the shared notifier and nothing role-specific to test. (human: ~0h extra / CC: ~0 min extra)
  ❌ The founder and finance get no revenue or commission in the digest, which weakens its purpose.
B) Role-scoped notifier (recommended)
  ✅ Finance and super admins get all five numbers; ops gets the three that are safe for them, enforced in the send path. (human: ~0.5 day / CC: ~20 min)
  ❌ Changes the shared notifier's queries and adds a role filter that other callers must not accidentally break, so it needs a regression test.
Net: Simplicity with a weaker digest vs a small shared-notifier change that delivers the intended one.
Header: Digest roles
A) Same digest for all
The digest sends only rides completed, completion rate and cancellation rate to every admin via the unchanged notifyAllAdmins(). Effort S, risk low, no change to shared code, verified by the digest tests only.
B) Role-scoped notifier (recommended)
Add an optional `roles` parameter to `getAllAdminIds` and `getAdminTokens` and to notifyAllAdmins; the digest job sends the five-KPI message to super_admin and finance_admin and the three-KPI message to ops_admin. Effort S, risk medium (shared notifier), reuses the existing notification pipeline, verified by a regression test that existing callers still reach every admin and a role test for the digest.

State: approved
Actual answer: CEO D6 = B "Role-scoped notifier (recommended)"
Accepted scope: add an optional `roles` filter to `getAllAdminIds`, `getAdminTokens` and `notifyAllAdmins` (join `admins.role`; default unchanged so every existing caller still reaches all admins); the digest sends five KPIs to `super_admin` and `finance_admin` and three (rides completed, completion rate, cancellation rate) to `ops_admin`; regression test that existing callers still notify every admin; role test for the digest. This replaces the role wording of CEO D3's scope; the rest of E2 stands.

## Spec review amendments (iteration 1, reviewer score 6/10)

Every item below is derived from an answer already given (eng D4, D5, D6, D10; CEO D2 to D5) or is a factual correction; none adds a new choice. Genuine open choices are listed at the end and stay unresolved.

**E1 shared KPI definitions (clarified).**
- Location: `api/src/modules/analytics/kpi-definitions.ts` (SQL fragments plus typed helpers). No general KPI framework: only the definitions listed here.
- Definitions (eng-D4 clocks): gross bookings = `SUM(payments.amount)` where `payments.status = 'completed'`, by ride `completed_at`; commission = `SUM(payments.commission_amount)` same filter; completed rides = `rides.status = 'completed'` by `completed_at`; requested and cancelled rides by `requested_at`; cancellation rate = cancelled / (completed + cancelled), the definition `getCityBreakdown` already uses (`analytics.repository.ts`, `cancellation_rate`).
- A completed ride whose payment is not yet `completed` counts as a completed ride and adds 0 to gross bookings and commission until the payment completes (no extra UI).
- Overview fields whose clock changes: `revenue_today` (`payments.created_at` to `completed_at`) and the completed-rides count (`requested_at` to `completed_at`); `total_rides_today` and cancelled counts stay on `requested_at`. The regression test lists the expected value for each field on a fixture that includes a midnight-crossing ride.
- The Overview query keeps its sargable IST day bounds (`[dayStart, dayEnd)` bound parameters, commit 7165eed); the new shared module reuses that helper, not `AT TIME ZONE` casts on columns.

**E2 daily digest (clarified).** KPIs, exactly five: rides completed, completion rate, cancellation rate, gross bookings, commission. `ops_admin` receives the first three only (D6). Empty day: "No completed rides yesterday" copy. Scheduling: superseded by iteration 2 (one `upsertJobScheduler('admin-digest', { pattern: '0 9 * * *', tz: 'Asia/Kolkata' })` plus a Redis dedupe key; no per-date job id). The digest reads the shared definitions directly and bypasses the D10 cache. Recorded: E2 was accepted over the CEO recommendation to defer; its stated trigger ("founder asks for proactive numbers") is not yet met.

**E3 cash discrepancy panel (clarified).** Fare source = `payments.amount` for the ride (`payments.ride_id` is unique); collected = `rides.cash_collected_amount`. A ride with `cash_collected_at IS NULL` and `cash_discrepancy = true` counts as uncollected (the 064 flag covers "collected != fare or not collected"). The panel reuses the rides review queue filter `cashDiscrepancy=true` (`admin.controller.ts:1160`) and the existing `cash_flagged_count` definition (`admin.repository.ts:1945`); range filter on `completed_at`.

**E4 refund and dispute rates (clarified).** Working definitions, unconfirmed by finance: refunds = `refunds.status = 'completed'` by `processed_at`; disputes = every status except `withdrawn` by `created_at`; denominator = completed rides in the same range (`completed_at`). Numerator and denominator are event-window rates, not cohort rates, so a refund for an earlier ride counts in the window it was processed. Refund and dispute **amounts** are money and are hidden from `ops_admin` on Overview and Finance (eng D6); counts and rates stay visible. **Build gate:** implementation of E4 starts only after finance confirms these definitions. Recorded: E4 was accepted over the CEO recommendation to defer.

**Consistency fixes.** R1 rewrites 3 queries (`getDailyRevenue`, `getCityBreakdown`, `getCategoryBreakdown`); `getTopDrivers` is already on `completed_at` and only gets D5's filter. R6 option B's phrase "take rate stays a later KPI" is moot under the accepted A. The CEO summary now says E4 semantics are "working definitions, unconfirmed".

**Task additions (accepted CEO scope) and coarser T10 split.**
- [ ] **T12 (P1, human: ~1d / CC: ~30min)** — shared KPI module (E1) + Overview regression and Overview-vs-Reports agreement test; lane A, before T2/T10
- [ ] **T13 (P2, human: ~1.5d / CC: ~40min)** — daily digest job (E2) with tz, scheduler upsert, per-role-class dedupe key, role content, empty-day tests; after T12, T5 and T16
- [ ] **T14 (P2, human: ~3h / CC: ~15min)** — Finance cash discrepancy panel (E3) + fixture test; after T10d
- [ ] **T15 (P2, human: ~0.5d / CC: ~20min)** — refund and dispute rates (E4); blocked until finance confirms definitions
- T10 is split into T10a KPI strip + compare endpoint, T10b drivers/quality, T10c cancellations + heatmap, T10d finance + CSV export + audit row, T10e tabs/filter bar UI. All keep T10's files, sources and verify steps; T10a depends on T12.
- Lane order (replaces the earlier lanes): Lane A: T12 -> T2 -> T3 -> T7 -> T5 -> T9 -> T10a-d -> T13 -> T14 -> T15; Lane B: T4 -> T6; Lane C: T8; Lane D: T1 -> T10e (after A's endpoints stabilise).

**Open product choices, unresolved (not defaulted).** Plan section 9 decisions 1 (audience order), 2 (Snapshots nav), 4 (motion scope), 5 (comparison default). Recommended defaults if you want them: finance-first after Phase 0/1, remove Snapshots, full motion table behind one `motion.ts`, previous-period comparison. RESOLVED later by the design review (D11 finance first, D12 remove Snapshots, D13 purposeful motion, D14 previous period on/off).

## Spec review amendments (iteration 2, reviewer score 6/10)

Corrections and clarifications derived from approved answers or verified repo facts; the only new choice (E2 roles) was asked as CEO D6 above.

- **E3 uncollected rule (corrected).** The earlier "`cash_collected_at IS NULL` and flag true" state cannot occur: `rides.service.ts:2373-2375` sets `cash_collected_at = now()` and the flag in one UPDATE, and `notCollected` records `cash_collected_amount = 0`. Definition: flagged rides = `cash_discrepancy = true`; "not collected" = flagged with `cash_collected_amount = 0`; the panel shows both counts and the amount gap (`payments.amount` minus collected). Range filter is `completed_at`. The existing `cash_flagged_count` on Overview is `requested_at::date = CURRENT_DATE` (`admin.repository.ts:1945`); E1 does not change it: the Overview count stays on `requested_at`, and the E3 panel is range-scoped on `completed_at` and labelled "completed in range", so the two can differ. The review-queue link (`cashDiscrepancy=true`, `admin.controller.ts:1160`) has no date filter, so it opens the queue unscoped by date; the panel's numbers are range-scoped. The fixture test builds a `notCollected` ride (amount 0, flag true), never an impossible row.
- **E2 scheduling (corrected).** One schedule across instances: BullMQ `upsertJobScheduler('admin-digest', { pattern: '0 9 * * *', tz: 'Asia/Kolkata' })` (the repo's current `queue.add(..., { repeat })` calls in `server.ts` set no tz). Delivery idempotency: a Redis `SET NX` key `admin-digest:<IST date>` (TTL 48 h) checked before sending. The digest covers the full previous IST day. Copy rules: no rides = "No completed rides yesterday"; only cancellations = "0 completed, N cancelled". The digest reads the shared definitions directly and bypasses the D10 cache.
- **E1 cancellation rate clock (clarified).** Cancellation rate is a requested-cohort rate: numerator and denominator both by `requested_at` (cancelled / (completed + cancelled) among rides requested in the range), as `getCityBreakdown` computes today. The completed-rides KPI stays on `completed_at`, so the two are labelled separately.
- **Refunded and disputed payments (working definition, same finance gate as E4).** Gross bookings and commission count `payments.status = 'completed'` only (matches every existing query and eng D5); rides whose payment is `refunded`, `partially_refunded` or `disputed` are excluded from gross and shown through the E4 refund and dispute figures. Finance confirms this together with the E4 definitions.
- **E4 (clarified).** The rates are labelled "event-window" in the UI and are not part of the gross reconciliation. `processed_at` is nullable in the schema: use `COALESCE(processed_at, updated_at)` for completed refunds and test it. Refund and dispute **amounts** are stripped for `ops_admin` in the service layer of the Overview and KPI endpoints (not only hidden in the UI), with a test per endpoint. Owner of the finance confirmation: the product owner (you); fallback if unconfirmed at build time: ship with the "working definition" label visible.
- **E1 helper (required proof).** The IST bounds helper from commit 7165eed must accept arbitrary `{from, to}` and compare windows; if it takes only "today", generalise it in T12 rather than adding `AT TIME ZONE` casts on columns.
- **D10 x E2 interaction.** Recorded in the CEO summary: the cache key has the role class, the digest bypasses the cache.
- **Sequencing fixes.** T6 (indexes) lands before T12 merges (Overview's `completed_at` counts must not scan the table). T14 follows T10d (Finance endpoints and role gating live there). T13 additionally depends on the role-scoped notifier work, now task T16 below. Lane B becomes T4 -> T6, and lane A's T12 waits for T6.
- [ ] **T16 (P2, human: ~0.5d / CC: ~20min)** — role-scoped notifier (CEO D6): optional `roles` filter on `getAllAdminIds`, `getAdminTokens`, `notifyAllAdmins`, default unchanged; regression test for existing callers; before T13.

### currentDecision (E5, from spec review; refines eng R3)
Reason: eng R3 (D6 = B) approved hiding money from `ops_admin` in the UI and gating finance endpoints and CSV server-side, but the existing `GET /analytics/summary` (`analytics.routes.ts:12-27`: `daily_revenue`, city `revenue`, `top_drivers.total_earnings`) and the new KPI endpoint stay callable by `ops_admin` (`requireAdmin('super_admin','ops_admin','finance_admin')`). Prior answer: eng D6 = "Add ops_admin (recommended)"; kept as history.
Commitment comparison:

| Commitment | Source or pending | Current (approved R3) | A Strip money server-side | B UI-hide only |
|---|---|---|---|---|
| Money fields in `/analytics/summary` for `ops_admin` (daily_revenue, city revenue, driver earnings) | pending | returned | removed by the service before responding | returned (UI hides them) |
| Money fields in the KPI endpoint for `ops_admin` (gross, commission, take rate) | pending | returned | removed | returned |
| E4 refund and dispute amounts for `ops_admin` | approved (iteration 2) | stripped in service | stripped in service | stripped in service |
| Per-endpoint role test | pending | none | included | none |
| Cache key role class (eng D10) | approved | finance vs ops | same, and now also guarantees ops payloads never contain money | same |

Question: D8 — E5: Should the API itself withhold money figures from ops admins?
Project/branch/task: Reports redesign plan on branch develop (spec review concern; evidence analytics.routes.ts:12-27, eng decision D6).
ELI10: We decided ops admins should not see revenue on the Reports page and we hide it in the screens. But screens are only a curtain: an ops admin who calls the same backend address directly still gets the revenue numbers today. The choice is whether the backend also removes the money before answering ops admins.
Stakes if we pick wrong: Revenue and driver earnings stay readable by ops through the API, contradicting the rule the plan is built on; or ops loses fields the dashboard already shows them.
Recommendation: A because a rule that only the UI enforces is not a rule, and the service already builds role-aware payloads for the cache key.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Strip money server-side for ops_admin (recommended)
  ✅ Ops never receives revenue, commission, take rate or earnings from any analytics endpoint, proved by a test per endpoint. (human: ~3h / CC: ~15 min)
  ❌ Existing consumers of /analytics/summary used by ops must be checked, and the response shape gains role-dependent fields the frontend must tolerate.
B) UI-hide only, accept API-visible money
  ✅ No backend change and no shape differences per role.
  ❌ The D6 money rule is only cosmetic, and the E4 amount stripping would be inconsistent with everything else.
Net: A real rule enforced at the source vs a curtain in the UI.
Header: Ops money API
A) Strip money server-side (recommended)
Add a service-layer step that removes gross, commission, take rate, daily revenue, city revenue and driver earnings from `/analytics/summary` and the KPI endpoint when the caller is `ops_admin` (fields absent, not zero), with a test per endpoint and a frontend tolerance for absent fields. Effort S, risk low, extends eng D6/D10 and the E4 stripping.
B) UI-hide only
Keep API responses unchanged for ops and record that API-visible money for `ops_admin` is accepted. Effort S, risk medium (rule not enforced at the source).

State: approved
Actual answer: CEO D8 = A "Strip money server-side (recommended)"
Accepted scope: a service-layer step removes gross bookings, commission, take rate, daily revenue, city revenue and driver earnings (fields absent, not zero) from `/analytics/summary` and the KPI endpoint for `ops_admin`; per-endpoint role test; the Reports frontend tolerates absent money fields; the D10 cache key already carries the role class. Adds task T17.
- [ ] **T17 (P1, human: ~3h / CC: ~15min)** — money stripping for `ops_admin` on `/analytics/summary` and the KPI endpoint + per-endpoint role tests + frontend tolerance; with T5, before T10a. Surfaced by: spec review (CEO D8).

### currentDecision (E6, Section 3 security)
Finding: P1, confidence 8, plan section 5 "Export" (CSV per tab with driver names, city names and codes) plus `analytics.repository.ts:75-80` (`d.full_name AS driver_name`, admin- and driver-controlled text). A cell that begins with `=`, `+`, `-`, `@`, tab or carriage return is executed as a formula when the file is opened in Excel or Sheets (CSV injection). Reviewer: Claude. Prior approval: plan section 5 approved CSV export (eng review), no cell-safety rule was stated.
Commitment comparison:

| Commitment | Source or pending | Current (plan) | A Neutralise formula cells | B Export raw values |
|---|---|---|---|---|
| Text cells starting with `= + - @ \t \r` | pending | written as-is | prefixed with `'` | written as-is |
| Numeric columns (amounts, counts) | approved | numbers | unchanged (numbers never prefixed) | unchanged |
| UTF-8 BOM and headers | approved | included | included | included |
| Test | pending | none | driver name `=HYPERLINK(...)` is exported neutralised | none |

Question: D10 — E6: Neutralise spreadsheet formulas in exported CSV text cells?
Project/branch/task: Reports redesign plan on branch develop (CEO review Section 3; evidence analytics.repository.ts:75-80 and plan section 5 Export).
ELI10: The CSV export contains names typed by drivers and admins. If a name starts with an equals sign or similar, Excel treats it as a formula and can run it when finance opens the file, for example to leak data or open a link. A tiny rule that puts an apostrophe in front of such cells makes them plain text.
Stakes if we pick wrong: A malicious driver name turns the finance CSV into an attack on whoever opens it.
Recommendation: A because the fix is a few lines in one shared CSV writer and closes a well-known attack on exactly the file finance will open.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Neutralise formula cells (recommended)
  ✅ Names beginning with = + - @ tab or CR are exported as text, so opening the file is safe. (human: ~1h / CC: ~5 min)
  ❌ A legitimate name starting with a dash gains a leading apostrophe in the file.
B) Export raw values
  ✅ Cell values match the database exactly.
  ❌ A hostile driver name can execute a formula in the finance user's spreadsheet.
Net: A leading apostrophe in rare cells vs a known attack path on finance.
Header: CSV safety
A) Neutralise formula cells (recommended)
The CSV writer prefixes text cells that start with `=`, `+`, `-`, `@`, tab or carriage return with a single quote and leaves numeric columns unchanged, with a test using a driver name like `=HYPERLINK("http://x","y")`. Effort S, risk low, one shared writer, verified by that test.
B) Export raw values
Write text cells unchanged and accept the formula-injection risk. Effort S, risk high.

State: approved
Actual answer: CEO D10 = A "Neutralise formula cells (recommended)"
Accepted scope: the shared CSV writer prefixes text cells starting with `=`, `+`, `-`, `@`, tab or carriage return with a single quote; numeric columns unchanged; test with a driver name like `=HYPERLINK("http://x","y")`. Adds task T18 (part of T10d, listed separately for the verify step).
- [ ] **T18 (P1, human: ~1h / CC: ~5min)** — CSV writer formula neutralisation + test; inside T10d. Surfaced by: CEO Section 3 (D10).

### currentDecision (E7, Section 8 observability)
Finding: P2, confidence 8, the plan adds a scheduled digest, a Redis response cache, an analytics pool and CSV export but no metrics or alerts (plan sections 6-8 and eng D7, D10, CEO D3). The repo already ships `api/src/observability/metrics.ts` (prom-client: `http_request_duration_seconds`, `pg_pool_connections`, `bullmq_queue_job_counts`) and Grafana Alloy shipping. Reviewer: Claude.
Commitment comparison:

| Commitment | Source or pending | Current | A Add minimal observability | B Skip |
|---|---|---|---|---|
| Metrics | pending | existing generic HTTP, pg pool, BullMQ counts | plus `analytics_cache_requests_total{result=hit|miss|bypass}`, `admin_digest_runs_total{result=sent|skipped_duplicate|failed}`, `analytics_export_total`, and `pg_pool_connections` labelled for the analytics pool | none |
| Alert | pending | none | one alert: no `admin_digest_runs_total{result="sent"}` increase in 26 hours | none |
| Structured logs | pending | generic | one log line per digest run and per export (admin id, tab, range, row count) | none |
| Runbook | pending | none | 6-line entry in `docs/OPS_RUNBOOK.md` for "digest did not arrive" and "Reports slow" | none |

Question: D11 — E7: Add minimal metrics, one alert and a runbook entry for the new Reports features?
Project/branch/task: Reports redesign plan on branch develop (CEO review Section 8; evidence api/src/observability/metrics.ts).
ELI10: The plan adds a daily digest job, a cache, a separate database pool and a CSV export. If the digest silently stops or Reports gets slow, nobody would know until someone complains. A handful of counters, one alert for "no digest in 26 hours" and a short runbook note make failures visible.
Stakes if we pick wrong: The daily digest quietly stops working and the founder assumes no news is good news.
Recommendation: A because a scheduled job with no signal is the classic silent failure, and the metrics stack already exists so the cost is small.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Add minimal observability (recommended)
  ✅ Digest, cache, export and pool failures become visible in Grafana with one alert. (human: ~0.5 day / CC: ~20 min)
  ❌ Adds four metrics, one alert rule and a runbook entry to maintain, and label cardinality must stay small.
B) Skip
  ✅ No extra metrics or alert rules.
  ❌ A stopped digest or a saturated analytics pool is discovered by users, not by monitoring.
Net: Small monitoring cost vs silent failure of a scheduled feature.
Header: Observability
A) Add minimal observability (recommended)
Add the three counters, an analytics-pool label on the pg pool gauge, one structured log per digest run and export, one Grafana alert (no digest sent in 26 hours) and a runbook entry, with a test that the counters increment. Effort S, risk low, reuses prom-client and Alloy.
B) Skip
Add no new metrics, alerts or runbook entry. Effort S, risk medium (silent failure of the digest).

State: approved
Actual answer: CEO D11 = A "Add minimal observability (recommended)"
Accepted scope: counters `analytics_cache_requests_total{result=hit|miss|bypass}`, `admin_digest_runs_total{result=sent|skipped_duplicate|failed}`, `analytics_export_total`; an analytics-pool label on the pg pool gauge; one structured log per digest run and per export (admin id, tab, range, row count); one Grafana alert (no digest `sent` increase in 26 hours); a 6-line entry in `docs/OPS_RUNBOOK.md`; a test that the counters increment. Adds task T19.
- [ ] **T19 (P2, human: ~0.5d / CC: ~20min)** — Reports metrics, alert and runbook entry; after T9, T13, T10d. Surfaced by: CEO Section 8 (D11).

## Spec review amendments (iteration 3, reviewer score 7/10; loop ended after three launches)

Mechanical fixes applied without a further review pass (they are corrections and definitions derived from approved answers):
- **Completion rate and take rate (defined).** Completion rate = completed / (completed + cancelled) among rides requested in the range (requested cohort, same clock as cancellation rate); take rate = commission / gross bookings on completed payments. Both live in `kpi-definitions.ts`. The KPI strip and the digest label them "of requests" so they are not confused with the `completed_at` completed-rides count.
- **E2 dedupe (corrected).** One Redis key per IST date and role class (`admin-digest:<date>:<finance|ops>`), set only after a successful send for that class, so a failed send is retried on the next scheduler tick.
- **E3 gap sign (defined).** Gap = `payments.amount - cash_collected_amount`; positive = short, negative = over-collected and shown as "over".
- **E4 placement (clarified).** "Overview" means the Reports Overview tab KPI strip plus the Finance tab; the admin dashboard Overview page only receives E1's clock change, not the new rates.
- **T12 verify step (added).** Check a cash ride's `payments.status` at collection time before finalising the gross-bookings filter, and record the result with the finance confirmation.
- **Cycle removed.** T6 no longer depends on T2 (see the Worktree table); lane B (T4 then T6) precedes T12's merge.

**Reviewer Concerns still open (reported, not resolved):**
1. Server-side money for `ops_admin`. Eng D6 and the E4 amendment strip money in the service layer only for finance endpoints, CSV and E4 amounts; the existing `/analytics/summary` (daily revenue, city revenue, driver earnings) and the new KPI endpoint would still return gross, commission, take rate and revenue series to `ops_admin` through the API while the UI hides them. Either strip those fields server-side for ops (with a per-endpoint test) or state that API-visible money for ops is accepted. RESOLVED by CEO D8 = strip money server-side for `ops_admin` (row E5, task T17).
2. Plan section 9 decisions 1, 2, 4, 5 (audience order, Snapshots nav, motion scope, comparison default): RESOLVED by the design review (D11-D14).
3. E2 was accepted over the CEO recommendation to defer and its trigger is unmet; E4 is build-gated on finance confirmation.

## CEO review sections (Selective Expansion, 2026-09-29)

**Current scope** (mode handoff carried forward): Mode SELECTIVE EXPANSION (CEO D1). Approved: eng D1-D10 (R1-R7), CEO D2 = E1 shared KPIs, D3 + D6 = E2 role-scoped digest, D4 = E3 cash panel, D5 = E4 refund/dispute rates (build-gated), D8 = E5 server-side money stripping, D10 = E6 CSV safety, D11 = E7 observability. Rejected: none. Deferred: none. Cut earlier by eng review: needs-attention list (D1), utilisation (D2).

### Section 1: Architecture

```
Browser (Reports tabs; URL = tab/range/city/compare)
   | GET /admin/analytics/{summary,kpis,drivers/quality,...}
   v
Express route -> Zod range schema -> requireAdmin(role) -> role class {finance|ops}
   v
service: money stripping for ops (E5) -> Redis cache (key = filters + role class, 60s, D10)
   | miss                                          | hit
   v                                               v
kpi-definitions.ts (E1)  <-------------------- also used by getAdminDashboardStats (Overview)
   v
analyticsPool (max 4, 60s timeout)  -> Postgres: rides(idx requested_at, completed_at), payments, ride_assignments,
                                                  ride_cancellations, refunds, disputes
CSV export -> shared writer (formula-safe, E6) -> admin-audit row -> download
Digest: BullMQ upsertJobScheduler('admin-digest', 09:00 Asia/Kolkata) -> kpi-definitions -> notifyAllAdmins({roles}) (T16)
        dedupe: Redis key admin-digest:<IST date>:<finance|ops>, set after successful send
Metrics: analytics_cache_requests_total, admin_digest_runs_total, analytics_export_total, pool label (E7)
```

- **[P2] (confidence: 8/10)** Redis is now on the digest path (dedupe) and the cache path. Required behavior: cache Redis errors fall through to the database (already accepted, D10); a dedupe-key Redis error must **skip the send, log and count `failed`**, never send twice or crash the scheduler. Covered by the E7 metric and the test list below.
- Coupling: `kpi-definitions.ts` becomes a shared dependency of Overview, Reports and the digest. That is the intended single source of truth; the fence "no general KPI framework" stands.
- Scaling: first break at 10x is the analytics pool (max 4) and the sequential scans before D8; both addressed. 100x needs a materialised daily rollup (not in scope, see Section 10).
- SPOFs: Redis (cache, dedupe) degrades to slower or skipped digest, never wrong numbers. Scheduler is a singleton by design.
- Rollback: additive migration (indexes) plus code-only changes; the blue/green switch reverts the Overview number change and the digest job in minutes; indexes stay harmlessly.

### Section 2: Error and rescue map

| Codepath | What can go wrong | Class | Rescued? | Rescue action | User sees |
|---|---|---|---|---|---|
| kpi/summary endpoints | DB timeout (60 s) | statement_timeout | Y (plan) | 504 with code, per-widget error card + Retry | clear error card |
| kpi/summary endpoints | analytics pool exhausted | pg connect timeout | Y (D7) | 503 for Reports only | error card |
| cache | Redis unavailable | ioredis error | Y (D10) | bypass, count `bypass` | slower load |
| digest job | send fails (push/in-app) | notification error | Y | do not set dedupe key, BullMQ attempts 3 with backoff, count `failed`, alert after 26 h | founder notices via alert |
| digest job | Redis dedupe check fails | ioredis error | GAP (now specified) | skip send, log, count `failed` | no duplicate digest |
| CSV export | stream error mid-file | pg/stream error | GAP (now specified) | abort the response with a 5xx (never a truncated 200 file), audit row `failed`, error toast | toast, no file |
| CSV export | range over cap or bad cityIds | ZodError | Y | 400 with field message | inline error |
| Overview (E1) | shared definition throws | query error | Y | existing dashboard error path, `dashboardQuery` timeout 30 s | dashboard error state |
| E4 rates | refund `processed_at` NULL | data | Y | `COALESCE(processed_at, updated_at)` | number shown, labelled event-window |

- **[P2] (confidence: 8/10)** `analytics.routes.ts` handlers use `next(err)`; no catch-all swallowing found. New handlers must name specific errors (ZodError, statement timeout SQLSTATE 57014) instead of a catch-all `500`. Carried into T10 requirements.
- **[P2] (confidence: 8/10)** The export must never return a partial file with a success status (table row above); test: force an error after the first chunk and assert non-200 plus `failed` audit row.

### Section 3: Security and threat model

| Threat | Likelihood | Impact | Mitigated? |
|---|---|---|---|
| CSV formula injection via driver/city names | Med | High | Yes, CEO D10 (E6) |
| ops_admin reads money via API | High | Med | Yes, CEO D8 (E5) |
| Export of financial data without trace | Med | High | Yes, admin-audit row (plan) |
| Range/`cityIds` abuse (huge ranges, thousands of ids) | Med | Med | Partly: range capped at 366 days; **add `cityIds` max length 50 to the Zod schema** (part of the approved range schema, no new choice) |
| Repeated large exports (DoS on analytics pool) | Low | Med | **Pending:** no rate limit specified. Proposal: reuse the existing rate-limit middleware (used on ride chat) on the export route. Not decided; listed as an unresolved decision. |
| Push notification exposes money on a lock screen | Low | Low | Accepted: finance and super admins only (T16) |
| Injection in filters | Low | High | Zod-validated numeric ids, parameterised queries only (project rule) |
| New secrets or dependencies | none | n/a | No new packages: BullMQ, ioredis, recharts, framer-motion already installed |

### Section 4: Data flow and interaction edge cases

```
INPUT (URL filters) -> VALIDATE (Zod: from<=to, <=366d, cityIds<=50) -> ROLE CLASS -> CACHE? -> QUERY (IST bounds)
   -> STRIP MONEY (ops) -> RESPOND -> RENDER (per widget)
shadow paths: nil/empty range -> empty state; from>to -> 400; timeout -> error card; stale response -> ignored (see below)
```

- **[P2] (confidence: 9/10)** Async ordering on the page: `load(period)` in `page.tsx:121-131` has no cancellation, so a slow response for an earlier filter can overwrite a newer one (last-writer-wins by arrival, not by request). Invariant: the widget shows data for the currently selected filters. Required proof: latest-wins guard (AbortController or request id) plus a test that resolves request 1 after request 2 and asserts request 2's data is shown. Carried into T1 and T10e.
- Interaction edge cases: double-click Export = second click disabled while pending (idempotent download); navigate away mid-export = request aborted; tab back/forward restores filters (URL state, plan section 5); session expiry = existing 401 handling; midnight IST boundary = fixture test (eng D4).

### Section 5: Code quality

- **[P2] (confidence: 9/10)** `Intl.NumberFormat('en-IN')` and `toLocaleString('en-IN')` are repeated six times in `analytics/page.tsx:53,203,230,242,264,430`; the approved `reports-format` helper replaces them. Also reuse it in `StatCard` callers only if they already format rupees; do not widen scope.
- **[P2] (confidence: 8/10)** Role-class mapping and money stripping must live in one helper used by summary, KPI, cache key and digest (T16/T17/T9). Two copies of the "who is ops" rule is the failure mode to avoid.
- Complexity: new methods stay small; the KPI query branches on role class only in the service layer, not in SQL.

### Section 6: Test review

Adds to the eng-review diagram (28 paths, 4 tested); new gaps from this review, all belonging to accepted behavior:

```
[+] E1 shared KPIs: [GAP] Overview vs Reports agree for a fixed day incl. midnight-crossing ride;
    [GAP] Overview regression: total_rides_today stays requested_at, revenue_today and completed count on completed_at
[+] E2 digest: [GAP] schedule/tz; [GAP] dedupe key per role class set only after success; [GAP] Redis error = skip;
    [GAP] role content (5 vs 3 KPIs); [GAP] empty day and cancellations-only copy
[+] E3 cash panel: [GAP] notCollected ride (amount 0, flag true); [GAP] gap sign (short/over)
[+] E4 rates: [GAP] each refund status and dispute status; [GAP] processed_at NULL fallback (build-gated)
[+] T16 notifier: [GAP] existing callers still reach every admin
[+] T17 money stripping: [GAP] ops payload has no money fields on summary and KPI (per endpoint)
[+] E6 CSV: [GAP] formula cell neutralised; [GAP] mid-stream failure returns non-200 + failed audit row
[+] Page: [GAP] latest-wins race test (controlled resolve order)
[+] E7: [GAP] counters increment (cache, digest, export)
COVERAGE (this review's additions): 0/18 tested; combined with eng review: 4/46 paths tested (9%).
```

- Ambition check: the 2am-Friday test is the Overview-vs-Reports agreement test; the hostile-QA test is the `=HYPERLINK` driver name plus an ops token calling `/analytics/summary`; the chaos test is Redis down during the 09:00 digest.
- Pyramid: many API integration tests, few component tests; no E2E framework in admin (manual QA plan covers export and 768px). Flakiness: time-dependent tests must inject the clock (digest schedule, "today" bounds). No LLM/prompt changes, so no eval scope.

### Section 7: Performance

- **[P2] (confidence: 8/10)** `getAdminDashboardStats` is a polled endpoint on its own 30 s statement timeout (`admin.repository.ts` `dashboardQuery`). E1 makes it join `payments` on `completed_at`; keep it on the main pool (a polled dashboard must not queue behind heavy reports in the 4-connection analytics pool) and rely on the D8 `completed_at` index, which T6 lands before T12. p99 estimate on current data: milliseconds; at 1M rides with the index: low tens of ms.
- Slowest new paths: heatmap over 366 days (index scan + hour bucketing), CSV export of 366 days (streamed), KPI compare in one `FILTER` query. Memory: export is streamed, cache payloads are small JSON.
- Pool pressure: analytics 4 (D7); Redis: negligible; digest runs once a day.

### Section 8: Observability

Resolved by CEO D11 (E7): metrics, structured logs per digest run and export, one alert, runbook entry. Debuggability: an export or digest incident is reconstructable from the log line (admin id, tab, range, row count) and the audit row.

### Section 9: Deployment and rollout

- Migration safety: two plain `CREATE INDEX` statements (brief write lock on `rides`; precedent 057); run in a quiet window; additive, backward compatible with old code.
- Rollout order: migrate indexes -> deploy API (shared KPI module, pool, cache, scheduler) -> deploy admin UI. Old and new code run together during blue/green: the digest scheduler upserts one schedule, dedupe key prevents a double send.
- **[P3] (confidence: 8/10)** One-time discontinuity: Overview "revenue today" and completed count shift for midnight-crossing rides on deploy day. Add a one-line note in the release notes and the runbook so ops is not surprised. No flag infrastructure exists (`feature_flags` is still a stub), so rollback is the blue/green switch.
- Post-deploy checklist: (1) `/analytics/summary` returns for super_admin, and for ops without money fields; (2) Overview vs Reports agree for yesterday; (3) `admin_digest_runs_total` after the next 09:00 IST; (4) pool metrics show the analytics pool.

### Section 10: Long-term trajectory

- Debt introduced: one shared module to maintain (intended), one more pool, one scheduler. Testing debt: no E2E for export.
- Reversibility: 4/5 (code-only plus additive indexes). Path dependency: the shared definitions make later KPIs cheaper; the digest channel (in-app/push) leaves room for email or WhatsApp later.
- The 1-year question: a new engineer reading `kpi-definitions.ts` and the runbook can explain any number. Next phases: daily rollup table when queries exceed the analytics timeout; per-city boards; digest channels.
- Retrospective (Selective): all four cherry-picks accepted, two of them over the CEO recommendation to defer (E2, E4); none rejected. E1 turned out load-bearing for E2, E3 and E4.

### Section 11: Design and UX (UI scope: yes)

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| KPI strip | skeleton matching card size | "No completed rides in range" | card-level error + Retry | value + delta | one KPI failed, others shown |
| Trend chart | dimmed previous data (never blank) | low-data caption when < 3 points | inline error + Retry | crossfade update | previous-period series missing = solid line only |
| Finance tab / CSV | disabled button + spinner | "No payments in range" | toast + audit `failed` | download + toast | n/a |
| Cash panel (E3) | skeleton | "No discrepancies in range" | card error | counts + gap ("short" / "over") | n/a |
| Ops view | as above | as above | as above | money fields absent, not zero (E5) | n/a |

```
Reports (URL state) -> [Overview] -> click KPI -> [tab explaining it] -> click city/driver -> Rides/Drivers page filtered
                    -> [Finance] (finance/super only) -> Export CSV -> download + toast
                    -> filter change: data dims, refetch (latest-wins), crossfade
```

- **[P2] (confidence: 8/10)** The frontend must render when money fields are absent for ops (E5); absent means "not shown", never `NaN` or 0. Covered by T17's frontend tolerance.
- **[P3] (confidence: 7/10)** Label copy for rates: "of requests" vs "completed in range" must appear in tooltips so the two clocks are not confused.
- This plan has significant UI scope: run /plan-design-review before implementation (open decisions 1, 2, 4, 5 are design choices), and /design-review on the live page after.

## NOT in scope
- Needs-attention auto-alert list (eng D1), driver hours-online and utilisation (eng D2), scheduled email reports, report builder, PDF export, saved views, cohort retention, YoY comparison, materialised daily rollup, digest channels beyond in-app and push, export rate limiting (undecided, see below), a real `payments.captured_at` clock.

## What already exists
`analyticsQuery` timeout wrapper, `ride_assignments`, `ride_cancellations`, `payments.commission_amount`, `StatCard`, `FilterBar`, `MultiSelectFilter`, `admin-audit`, Redis, BullMQ, `notifyAllAdmins`, `getAdminDashboardStats` sargable IST helper, `metrics.ts`, Grafana Alloy, `docs/OPS_RUNBOOK.md`, the rides review queue with `cashDiscrepancy` filter.

## Dream state delta
```
CURRENT: chart gallery, 3 revenue clocks, silent failures
THIS PLAN: trusted KPI layer (Overview = Reports = CSV = digest), role-safe at the API, observable
12-MONTH IDEAL: daily rollup table, per-city boards, more digest channels, anomaly alerts once thresholds are known
```

## Failure modes registry

| Codepath | Failure | Rescued | Test | User sees | Logged |
|---|---|---|---|---|---|
| digest send | push/in-app fails | Y (retry, no dedupe key) | planned | alert after 26 h | Y |
| digest dedupe | Redis error | Y (skip) | planned | nothing (no duplicate) | Y |
| CSV export | mid-stream error | Y (non-200) | planned | error toast | Y |
| cache | Redis down | Y (bypass) | planned | slower | Y |
| ops API | money leak | Y (strip) | planned | n/a | n/a |
| page | stale response overwrites | Y (latest-wins) | planned | correct data | n/a |
| existing page | API 500 shown as zeros | plan Phase 0 | planned | **silent today** | N |

Critical gaps: 1, the existing page's silent zeros (already flagged by the eng review; fixed by T1).

## Implementation tasks added by this review
T12-T17 are listed in the amendments above; T18 (CSV neutralisation) and T19 (observability) were added by D10 and D11 in the ledger. Additional required behaviors folded into existing tasks without new approvals: `cityIds` max 50 (T2), export abort on mid-stream error and named-error handling (T10d), latest-wins guard (T1, T10e), deploy-day release note (T12).

## Unresolved decisions
- Plan section 9 decision 1: who is Reports for first (ops health vs finance).
- Plan section 9 decision 2: Snapshots nav item (delete or keep).
- Plan section 9 decision 4: motion pass scope (full vs light).
- Plan section 9 decision 5: comparison default (previous period vs YoY).
- Export rate limiting (Section 3): proposed remedy not yet decided.

## Completion summary (CEO review)
- Mode: SELECTIVE EXPANSION; proposals 4, accepted 4, deferred 0, skipped 0 (plus 4 follow-on decisions: D6, D8, D10, D11)
- Sections: 1-11 reviewed; findings: Architecture 1, Error map 2, Security 2, Data flow 2, Code quality 2, Tests 12 new gaps, Performance 1, Observability 1 (resolved), Deployment 1, Design 2
- Spec review: 3 launches, final score 7/10, issues 52 reported, 12 confirmed fixed, 11 remaining at last pass (mechanical fixes applied after)
- Outside voice: codex, unavailable (two failures: argument size, then network reconnect errors); native fallback unavailable (TaskOutput not in this session); missing coverage
- Critical gaps: 1 (pre-existing silent zeros)
- Unresolved decisions: 5 at the time (4 product choices later resolved by the design review, D11-D14; export rate limiting still open)

# Engineering review 2 (/plan-eng-review re-run, 2026-09-29)

Target: this plan (state after the CEO and design reviews). Prior decisions R1-R7, E1-E7 and design D2-D14 are reused as approved. Scope-challenge answer: EE-D1 = "Confirm arrangement (recommended)" (arrangement of about 25 files inside the existing analytics and notifications modules stands).

## Corrections from this review (facts, no decision needed)
- Digest recipients: `getAllAdminIds` is `SELECT id::text FROM admins` (`notifications.repository.ts:218-221`), so it includes inactive admins and `support_admin`. The role-filtered path in T16 selects only `super_admin`, `finance_admin`, `ops_admin` with `is_active = true`; the default path for existing callers is unchanged (the pre-existing inactive-admin behavior is noted, not changed here).
- Digest queries must use `analyticsPool` (eng D7), not `pool` or `workerPool` (`client.ts:103,122`), although the digest runs inside a BullMQ worker; test asserts the pool used.
- E5's money list moves with design D2: the KPI endpoint serves the six Overview KPIs (gross bookings, commission, completed rides, completion %, cancellation %, active drivers; money fields stripped for `ops_admin`); take rate, refund rate and dispute rate are served by the Finance endpoint (403 for `ops_admin`).

## Engineering decision ledger (this review)

### EE-R1: Definition of the "Active drivers" KPI
Finding: EE #1, P2, confidence 9, `analytics.repository.ts:110` (`active_drivers` = `COUNT(*) FROM drivers WHERE city_id = c.id AND status = 'active'`, a current snapshot); no definition in E1 or the KPI list, reviewer: Claude.
Plan baseline: original proposal (design D2 keeps "Active drivers" in the six-tile band; E1 defines gross bookings, commission, completed rides, completion rate and cancellation rate only).
Runtime evidence: source read; `driver_status_history` exists (used by the onboarding funnel) but the current query does not use it.
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Definition | none (city snapshot exists) | drivers with at least one completed ride in the range (`completed_at`) | drivers with `status = 'active'` at the end of the range | drivers with an online session in the range |
| Delta vs previous period | n/a | computable from rides | needs `driver_status_history` replay | computable from `driver_sessions` |
| Source tables | drivers | rides | drivers + driver_status_history | driver_sessions |
| Same clock as completed rides (eng D4) | n/a | yes | no | no |

Question D2: EE-R1 — What does "Active drivers" mean on the Overview strip?
Project/branch/task: Reports redesign plan on branch develop (second eng review; evidence analytics.repository.ts:110 and the design D2 six-tile band).
ELI10: One of the six headline numbers is "Active drivers", but the plan never says what counts as active. It could mean drivers who actually drove this period, drivers who are approved and not suspended, or drivers who went online at all. The existing query counts approved drivers right now, which cannot show how the number changed compared with the previous period.
Stakes if we pick wrong: The tile shows a number that never moves (approved drivers) or that ops reads as "drivers working" when it is not.
Recommendation: A because it uses the same completed_at clock as every other Overview KPI, supports a real delta against the previous period, and reflects drivers who earned in the range.
Completeness: Note: options differ in kind, not coverage, so there is no completeness score.
Pros / cons:
A) Drivers with at least one completed ride in the range (recommended)
  ✅ One rides query on the completed_at clock; delta vs previous period is exact; matches "drivers who worked". (human: ~1h / CC: ~5 min)
  ❌ Drivers who were online but got no completed ride do not count, so it understates supply on quiet days.
B) Drivers with status active at the end of the range
  ✅ Matches today's city breakdown wording and the fleet size finance and ops know.
  ❌ Needs a driver_status_history replay to get a previous-period value, and it barely changes between periods.
C) Drivers with an online session in the range
  ✅ Best measure of offered supply.
  ❌ Uses a different table and clock from every other KPI, and open or crashed sessions make it noisy.
Net: Drivers who actually completed rides vs fleet size vs online supply.
Header: Active drivers
Options:
A) Completed a ride in range (recommended)
Count distinct `rides.driver_id` with `status = 'completed'` and `completed_at` in the range, delta vs the previous window, defined in `kpi-definitions.ts` with a test (driver with two rides counts once; driver with only cancelled rides does not). Effort S, risk low, reuses the eng D4 clock.
B) Status active at end of range
Count drivers whose status is `active` at the end of the range using `driver_status_history`, previous-period value from the same replay. Effort M, risk medium.
C) Online session in range
Count distinct drivers with a `driver_sessions` row overlapping the range. Effort M, risk medium (open and crashed sessions).

State: approved
Actual answer: EE-D2 = A "Completed a ride in range (recommended)"
Accepted scope: "Active drivers" = count of distinct `rides.driver_id` with `status = 'completed'` and `completed_at` in the range (IST-day `{from,to}`), delta vs the previous window, defined in `kpi-definitions.ts` (part of T12); test: a driver with two completed rides counts once, a driver with only cancelled rides does not, a ride completed just after IST midnight lands in the next day's window. The city breakdown's existing `active_drivers` (status snapshot) keeps its name and meaning and is labelled "active fleet" in the By City table to avoid confusion.

# Design review (/plan-design-review, 2026-09-29)

Target: this plan. Evidence: `.scratch/reports-audit/` screenshots (1440, 768, 390), `DESIGN.md`, `PRODUCT.md`. Mockups: not generated (the gstack designer needs an OpenAI key and none is configured); text-only review. Outside design voices: not run (Codex unreachable earlier in this session; not requested).
Classifier: OPERATE (admin dashboard). Focus: all 7 passes (D1).

## Design decisions (each answered individually)

| # | Decision | Answer |
|---|---|---|
| D2 (1A) | Overview strip holds six KPIs: Gross bookings, Ocar revenue (commission), Completed rides, Completion %, Cancellation %, Active drivers; take rate, refund rate, dispute rate move to the Finance tab (reverses CEO D5's Overview placement for the rates) | Six tiles, rest on Finance |
| D3 (1B) | Page title lives in the top bar only; tabs and filter bar start directly under it; per-tab name in the top bar subtitle | Top bar only |
| D4 (2A) | Every empty state offers one action matching its cause (widen range, clear city or category filter, none when the system has no data) | One action per empty state |
| D5 (4A) | KPI strip is one connected card with 1px `{colors.border}` dividers; `StatCard` gains a `band` variant (no own shadow or radius) | One band |
| D6 (5A) | Categorical chart colours: `{colors.primary}`, `{colors.primary-dark}`, `{colors.info}`, `{colors.ink-600}`, `{colors.ink-400}` (max 5, top 5 + other); success/warning/error only for good/watch/bad with icon or word; previous-period series dashed `{colors.ink-400}`; no orange or violet | Teal and ink tints |
| D7 (5B) | Active tab is a filled pill (`{colors.primary}` bg, white text; unselected `{colors.surface-2}`, `{colors.ink-600}`), background slides 200 ms; `role=tablist` with arrow-key navigation | Filled pill |
| D8 (5C) | Tables: sentence-case Label headers (`{typography.label}` 13px/600, `{colors.ink-600}` on `{colors.surface-2}`), rows 48px minimum, hover `{colors.surface-2}` | Follow DESIGN.md spec |
| D9 (5D) | Money, counts and percentages in tables use `{typography.mono}` (JetBrains Mono 14px, tnum), right-aligned; KPI numerals stay Space Grotesk with tabular figures | Mono in tables |
| D10 (6A) | Range control: preset chips (7d, 30d, 90d, This month, Last month) in the selected-chip style; "Custom" reveals two labelled native date inputs (From, To); invalid range shows an inline message; state in the URL | Chips + native dates |
| D11 (7A) | Build order: finance first (shared KPI module, labels, Finance tab, export, role stripping), then Overview polish, then ops tabs; default landing tab is Overview for every role | Finance first |
| D12 (7B) | Remove the `/snapshots` entry from `AdminSidebar` (Analytics group keeps Reports only) | Remove |
| D13 (7C) | Motion: tab pill slide 200 ms; filter change dims old data to 60% and crossfades 200 ms (never blank); charts tween from previous values 250 ms ease-out; KPI numbers tween 250 ms only when the value changes; no entrance stagger, no line draw-in, no pulsing dot (text "Updated Ns ago"); reduced motion = opacity only, 100 ms; one `motion.ts` config. Supersedes plan section 6's table and Phase 4's choreography | Purposeful 150-250 ms |
| D14 (7D) | Comparison is previous period only, an On/Off toggle defaulting On (`cmp=prev\|off`); empty previous window shows "no comparison data", never 0% or NaN | Previous period on/off |

## Pass ratings

| Pass | Before | After | Remaining gap |
|---|---|---|---|
| 1 Information architecture | 6 | 9 | none material |
| 2 Interaction states | 7 | 8 | heatmap and driver-quality table have no explicit state rows (follow the CEO Section 11 table pattern) |
| 3 User journey | 8 | 9 | storyboard recorded, no question needed |
| 4 AI slop risk | 6 | 8 | panels are still cards (DESIGN.md house style); hard rejection 7 mitigated by the KPI band and one-table cards |
| 5 Design system alignment | 5 | 9 | sticky filter bar material undecided (see below) |
| 6 Responsive and accessibility | 7 | 9 | none material |
| 7 Decisions register | n/a | 13 resolved, 2 deferred | see below |

Overall design score: 5/10 (lowest pass before, Pass 5) to 8/10 (lowest pass after: Pass 2 and Pass 4).

## Storyboard (Pass 3)

```
STEP | USER DOES                         | USER FEELS           | PLAN SPECIFIES?
1    | Ops lead opens Reports at 9:05    | hurried, anxious     | six-tile band + deltas readable in ~5 s
2    | Sees cancellation % up, clicks it | concerned            | KPI click jumps to the explaining tab
3    | Picks a city row                  | wants to act         | row links to Rides filtered (drill-through)
4    | Finance runs month-end export     | needs certainty      | clocks tooltip, "Updated Ns ago", export toast + audit row
5    | API is down                       | must still trust     | error card + Retry, never zeros
6    | Returns next week                 | expects same numbers | Overview = Reports = CSV = digest
5-second (visceral): the KPI band. 5-minute (behavioral): drill from KPI to tab to row. 5-year (reflective): numbers agree everywhere.
```

## Interaction state addition (Pass 2, D4)
Empty states, per widget: KPI band "No completed rides in this range" + [Show last 90 days] when the range is under 90 days; charts and tables with a city or category filter on: [Clear city filter]; whole-system empty (no rides ever): message only. Heatmap and driver-quality table reuse this rule; their loading/error/partial rows are still to be written into the state table.

## Tasks from the design review (accepted decisions only)
- [ ] **T20 (P1, human: ~2h / CC: ~15min)** — StatCard `band` variant + KPI band of six on Overview (D2, D5); before T10a. Files: `apps/admin/components/ui/StatCard.tsx`, Reports page. Verify: StatCard regression test (existing props) plus band snapshot; take rate, refund rate and dispute rate are absent from Overview and present on Finance.
- [ ] **T21 (P1, human: ~1h / CC: ~10min)** — remove the in-page "Reports" heading; top bar subtitle shows the active tab (D3). Files: `apps/admin/app/(dashboard)/layout.tsx`, analytics page. Verify: one title at 1440 and 768.
- [ ] **T22 (P2, human: ~0.5d / CC: ~30min)** — empty-state action rule + tests per variant (D4). Verify: RTL tests for range-short, filter-on and system-empty.
- [ ] **T23 (P2, human: ~2h / CC: ~10min)** — chart tokens: palette per D6, previous series dashed `ink-400`, tooltip component; folds in T11 (`COLORS.border` to `#DCEBEE`). Files: `apps/admin/lib/colors.ts`, tailwind config, `ChartTooltip`.
- [ ] **T24 (P2, human: ~0.5d / CC: ~20min)** — Reports tab component: filled sliding pill, `role=tablist`, arrow keys, `aria-selected`, URL state (D7).
- [ ] **T25 (P2, human: ~2h / CC: ~10min)** — table spec: sentence-case headers, 48px rows, hover token, right-aligned Mono numerals; confirm JetBrains Mono is loaded by the admin app (D8, D9). Files: `apps/admin/app/globals.css` (`.data-table`), fonts config.
- [ ] **T26 (P2, human: ~0.5d / CC: ~20min)** — range control: chips + native date inputs, inline invalid-range message, URL params (D10).
- [ ] **T27 (P2, human: ~10min / CC: ~2min)** — delete the `/snapshots` sidebar entry (D12). Files: `AdminSidebar.tsx`.
- [ ] **T28 (P2, human: ~0.5d / CC: ~30min)** — `motion.ts` config with the D13 set (framer-motion already installed), reduced-motion path, no remounts of charts on filter change. Replaces the plan's Phase 4 choreography.
- [ ] **T29 (P2, human: ~1h / CC: ~10min)** — comparison toggle (`cmp=prev|off`), empty-previous copy (D14).
- Ordering (D11): phases run finance first: T12 (shared KPIs), T2, T3, T7, T5/T17, then T10d Finance tab and export (with T18), T14, T15; then Overview polish (T20-T25, T28); then ops tabs (T10b, T10c).
- JSONL artifact: not written (`jq` is not installed).

## Unresolved (design)
- Sticky filter bar material: solid vs light glass per DESIGN.md 4a (a sticky bar over scrolling content is a floating layer); if unanswered the implementer uses solid `{colors.surface}` with the card shadow, which is DESIGN.md-safe.
- Explicit loading/error/partial state rows for the heatmap and the driver-quality table (pattern exists; rows not yet written).

## NOT in scope (design)
Custom calendar popover, year-over-year comparison, entrance choreography and line draw-in, pulsing live indicator, dark mode, a new admin button style beyond the existing Secondary and primary chip patterns, new fonts.

## What already exists (design)
DESIGN.md tokens and rules (Data Tables, chips, Card Admin shadow, Orange Boundary, motion budget), `StatCard`, `FilterBar`, `MultiSelectFilter`, `.data-table` and `.admin-card` classes, the selected-chip pattern, Space Grotesk / Plus Jakarta Sans / JetBrains Mono roles, recharts, framer-motion.

## Design completion summary
```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md + PRODUCT.md present; large UI scope|
  | Step 0               | 5/10 initial; focus: all 7 passes            |
  | Pass 1  (Info Arch)  | 6/10 → 9/10 after fixes                      |
  | Pass 2  (States)     | 7/10 → 8/10 after fixes                      |
  | Pass 3  (Journey)    | 8/10 → 9/10 after fixes                      |
  | Pass 4  (AI Slop)    | 6/10 → 8/10 after fixes                      |
  | Pass 5  (Design Sys) | 5/10 → 9/10 after fixes                      |
  | Pass 6  (Responsive) | 7/10 → 9/10 after fixes                      |
  | Pass 7  (Decisions)  | 13 resolved, 2 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (7 items)                            |
  | What already exists  | written                                      |
  | TODOS.md updates     | 0 items proposed                             |
  | Approved Mockups     | 0 generated, 0 approved (no OpenAI key)      |
  | Decisions made       | 13 added to plan                             |
  | Decisions deferred   | 2 (listed above)                             |
  | Overall design score | 5/10 → 8/10                                  |
  +====================================================================+
```
Plan is not yet design-complete at 10; all rated passes are 8 or above. Run `/design-review` on the live page after implementation for visual QA.

# Engineering review 2: sections (2026-09-29)

Scope Challenge: scope reduced? No. Arrangement confirmed (EE-D1); no feature cuts proposed. Search check: no new architectural pattern beyond what BullMQ `upsertJobScheduler`, ioredis `SET NX`, and prom-client already provide (layer 1); web search not needed.

### Section 1: Architecture (2 issues)
The CEO Section 1 diagram stands. Changes from this review:
- **[P2] (confidence: 9/10)** `notifications.repository.ts:218-221` selects every admin including inactive and `support_admin`; the role-filtered digest path selects `super_admin`, `finance_admin`, `ops_admin` with `is_active = true` (see corrections above).
- **[P2] (confidence: 8/10)** `client.ts:103,122` the digest runs in a BullMQ worker with `workerPool`; its analytics queries go through `analyticsPool` (eng D7) with a test that names the pool used.
- Failure mode reviewed: scheduler registered by both blue and green instances (`upsertJobScheduler` is idempotent) and Redis dedupe per IST date and role class; a stale color still consuming jobs is harmless because the job reads current definitions.

### Section 2: Code quality (3 issues)
- **[P2] (confidence: 9/10)** "Active drivers" had no definition; resolved by EE-D2 (completed a ride in range).
- **[P3] (confidence: 8/10)** E5's money list named take rate on the KPI endpoint; corrected: KPI endpoint = six Overview KPIs, Finance endpoint = take rate, refund and dispute rates (403 for ops).
- **[P2] (confidence: 8/10)** Task overlap after three reviews: T8 (StatCard sparkline slot) and T20 (StatCard band) edit the same component; T11 (`COLORS.border`) is folded into T23; T28 replaces the plan's Phase 4 choreography; T24-T27 and T29 share the Reports page with T1 and T10e. Merge as T30 below to avoid conflicting PRs.
- Shared code: the role-class helper (finance vs ops) is the one reusable unit (summary, KPI, cache key, digest, CSV routes): at least five callers, one contract, saves ~5 duplicated conditionals; already approved under E5/T17.

### Section 3: Test review
New gaps from decisions made after the first eng review (added to the earlier 46-path diagram):

```
[+] EE-D2 Active drivers: [GAP] driver with two completed rides counts once; cancelled-only driver excluded; IST midnight boundary
[+] Digest recipients (T16): [GAP] inactive admin and support_admin excluded; existing notifyAllAdmins callers unchanged
[+] Digest pool routing: [GAP] analytics queries use analyticsPool from the worker
[+] KPI vs Finance endpoints: [GAP] take rate absent from KPI endpoint; ops gets 403 on Finance endpoint
[+] StatCard band variant (design D5): [GAP] existing props still render on the 6 pages; band has no own shadow
[+] Empty states (D4): [GAP] range-short, filter-on, system-empty variants
[+] Tabs (D7): [GAP] arrow keys, aria-selected, URL state
[+] Range control (D10): [GAP] preset chips, custom from>to inline error, URL params
[+] Comparison (D14): [GAP] off, empty previous window ("no comparison data", never 0% or NaN)
[+] Motion (D13): [GAP] reduced-motion path is opacity-only; no chart remount on filter change
COVERAGE (additions): 0/10 tested; combined with earlier reviews: 4/56 paths tested (7%).
```
All belong to approved behavior (no new test-depth policy proposed). No E2E framework in admin; QA test-plan artifact covers export, 768px and role paths (updated below).

### Section 4: Performance
No issues found beyond earlier decisions: sparkline series come from one grouped query per source with `FILTER` (6 series x up to 90 daily points, weekly buckets beyond 90 days), Active drivers is a distinct count on the new `completed_at` index, the digest is a single 09:00 run on `analyticsPool`.

### Outside voice
codex: unavailable (third failure: network reconnect errors, exit 1); native fallback not attempted (TaskOutput unavailable). Missing coverage, not a clean review.

### TODOS.md
No deferred TODO proposed; no change.

## Engineering review 2: approval readiness
PASS. Checked EE-D1 (structure) and EE-D2 = EE-R1 (Active drivers); factual corrections need no approval; all earlier rows keep their answers (R1-R7, E1-E7, design D2-D14).

## NOT in scope (unchanged) and What already exists (unchanged)
See the earlier sections; this review adds nothing new to either.

## Implementation Tasks (changes from this review)
- [ ] **T30 (P2, human: ~1h / CC: ~10min)** — task hygiene: merge T8 and T20 into one StatCard task (sparkline slot + `band` variant + regression); fold T11 into T23; T28 replaces the plan's Phase 4; T1, T21, T22, T24-T27, T29 land in that order on the Reports page before T10e. Surfaced by: Section 2 task overlap.
- [ ] **T31 (P1, human: ~1d / CC: ~40min)** — write the ten test gaps above alongside their features (EE-D2 Active drivers, digest recipients and pool, endpoint split, StatCard band, empty states, tabs, range control, comparison, reduced-motion). Surfaced by: Section 3.
- T12 gains the Active drivers definition; T16 gains the recipient filter (`is_active`, roles); T10a serves the six KPIs and T10d the Finance endpoint (take rate, refund and dispute rates).
- Lane order (finance first, design D11): Lane A: T12 -> T2 -> T3 -> T7 -> T5/T17 -> T9 -> T10a + T10d (+T18) -> T16 -> T13 -> T14 -> T15 -> T19; Lane B: T4 -> T6 (before T12 merges); Lane C: StatCard task (T8+T20); Lane D (page): T1 -> T21 -> T24 -> T26 -> T22 -> T23/T25 -> T29 -> T28 -> T10e -> T10b/T10c.
- JSONL artifact: not written (`jq` is not installed).

## Completion summary (eng review 2)
- Step 0: Scope Challenge: scope accepted as-is (arrangement confirmed, no cuts)
- Architecture Review: 2 issues found
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 10 gaps identified
- Performance Review: 0 issues found
- NOT in scope: unchanged
- What already exists: unchanged
- TODOS.md updates: 0 items proposed
- Failure modes: 1 critical gap flagged (unchanged: existing page shows API failure as zeros; fixed by T1)
- Unresolved decisions: 3 (sticky filter bar material, heatmap and driver-quality state rows, export rate limiting)
- Outside voice: codex, unavailable (network); missing coverage
- Parallelization: 4 lanes, 3 parallel / 1 sequential merge tail
- Lake Score: 0/0, N/A (all answers were kind choices)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 3 | ISSUES OPEN (2026-09-29) | 4 proposals, 4 accepted, 0 deferred |
| Outside Review | codex outside voice (eng, CEO, eng re-run) | Independent 2nd opinion | 4 | unavailable | three passes each failed (CLI exit 1, network reconnect errors) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 10 | ISSUES OPEN (this run) | 15 issues, 1 critical gap |
| Design Review | `/plan-design-review` | UI/UX gaps | 5 | ISSUES OPEN (2026-09-29) | score: 5/10 → 8/10, 13 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | skipped (2026-09-17, stale) | — |

**OUTSIDE COVERAGE:** codex, plan-review phase, unavailable for the eng, CEO and eng re-run passes (exit 1; network reconnect errors); design outside voices not run; native fallbacks not attempted (TaskOutput unavailable). Never counted as clean.
**VERDICT:** ENG REVIEW ISSUES OPEN (open items are the three unresolved decisions below and mapped tasks T1-T31; no unmapped engineering issue remains), CEO REVIEW ISSUES OPEN, DESIGN REVIEW ISSUES OPEN; eng review required until those three are answered.

**UNRESOLVED DECISIONS:**
- Sticky filter bar material (design): solid vs light glass; default solid if unanswered.
- Heatmap and driver-quality table state rows (design): pattern exists, rows not written.
- Export rate limiting (CEO Section 3): proposed remedy not yet decided.
- + 7 unresolved recorded in the latest CEO and design review logs: these are the three items above plus the four plan section 9 product choices, resolved by design D11-D14 and still counted in the CEO log.
