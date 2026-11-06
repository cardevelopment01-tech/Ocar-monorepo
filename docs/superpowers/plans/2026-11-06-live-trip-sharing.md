# Live Trip Sharing — Design & Implementation Plan

> Client bug #8: "live trip sharing option is not available". Goal: a rider can share a live trip with anyone; a recipient with no app and no account sees it on a clean tracking page; the rider stays in control; SOS uses the same mechanism.

**Status:** draft for review (eng + design). **Touches:** rider-mobile, API, apps/user (web). **Effort:** ~6–8 dev-days.

## 1. What big players do (research)

- **Uber:** the rider taps *Share trip status*, picks up to 5 contacts, each gets an SMS link; opening it shows the driver's **first name, vehicle info and the rider's live map location**, no app needed. The driver app has a mirror feature (name, phone, plate, live map, *no rider details*). Sharing is stopped manually. ([Uber](https://www.uber.com/gb/en/ride/how-it-works/share-status))
- **Ola:** up to 5 emergency contacts get the tracking link and driver details by SMS; optional automatic sharing to trusted contacts. ([Ola](https://ola.co.uk/faq/how-do-i-set-emergency-contacts-2/); third-party summaries, official Ola docs not found)
- **Link security patterns:** unguessable private URL, owner can revoke, time-limited, server rejects expired/revoked links immediately, link scoped to one trip. ([privacy patterns](https://privacypatterns.cs.ru.nl/patterns/Private-link))
- **Not found in research** (so the decisions below are ours and flagged): expiry-at-trip-end behaviour, rate limiting of token lookups, what a public page must hide.

## 2. What already exists in Ocar

- `user_emergency_contacts` (≤3 per rider; rider-mobile Profile → Safety; `/api/v1/emergency-contacts`).
- SOS texts those contacts a **static** Google Maps pin (`sos_contact` template). This is upgraded to the live link (§7).
- The rider ride screen has an actions strip (`RideActions`: Trip details / Edit pickup / Add stop / Cancel). Share goes here.
- Driver position: `driver_location_snapshots`; socket `driver:location` (auth-only, so unusable for anonymous viewers).
- SMS via Fast2SMS needs a **DLT-registered template** per message (as for `sos_contact`).
- `apps/user` (Next.js) can host a public route outside `(main)`; `USER_APP_URL` is already https-enforced in prod.

## 3. Decisions (mine unless noted — challenge them in review)

| # | Decision | Why |
|---|---|---|
| D1 | **Primary channel = the phone's share sheet** (WhatsApp, SMS, anything); SMS-from-Ocar to saved contacts is secondary | WhatsApp dominates India and needs **no DLT template**; SMS needs vendor approval |
| D2 | **Public page, no login, polling every 5 s** (not sockets) | Anonymous sockets add auth/abuse surface; 5 s polling is cacheable and rate-limitable |
| D3 | **One token = one share.** A share is per recipient when sent by SMS, one anonymous link when sent via the share sheet | Each is individually revocable and countable |
| D4 | Token: 128-bit random, **only SHA-256 stored** (same rule as refresh tokens) | A DB leak yields no usable links. Because the server cannot return a link again, the rider app stores each created URL in secure storage keyed by share id and shows it on reopen; without it the sheet lists shares and offers "Create a new link" (eng review D4) |
| D5 | The link follows the **ride**, not the driver: if the driver is reassigned the page shows the new driver | Safety: the sharer cares about the trip |
| D6 | **Live from driver-assigned to trip end.** After completion the page shows "Trip completed" for 30 min, then expires; cancelled shows "Trip cancelled". Hard cap 7 days after creation (rentals / round trips run long) | Avoids a permanent location link |
| D7 | Public page shows: rider **first name**, driver **first name**, vehicle colour/brand/model + **plate**, status, ETA, pickup/drop labels, planned route, driver live dot. **Never**: phones, fare, OTP/PIN, driver photo, location history trail, payment | The minimum needed for "is my person safe" |
| D8 | v1 excludes auto-share on trip start, "contact viewed your trip" push, driver-side sharing, and a rider web-app button. They are v2 | Keep v1 shippable; each needs its own consent UX |

## 4. UX

### Rider app (rider-mobile)
1. **Entry:** `Share trip` as the **first** item in the ride actions strip once a driver is assigned (icon `share-2`). Also a "Share live trip" row in the SOS sheet.
2. **Share sheet (bottom sheet):**
   - Primary button **Share link** → creates a share and opens the OS share sheet with *"Track my Ocar ride live: https://…/t/<token>"*.
   - **Send to my contacts** = saved emergency contacts with checkboxes (+ "Add a contact" → existing add flow). Button *Send SMS (n)*.
   - Footer (design review D11): "They will see your pickup, drop-off and live location until the trip ends. You can stop sharing anytime." The full pickup/drop labels and route are shown on the public page; a hide-destination option is deferred to v2.
3. **While sharing:** a slim banner above the sheet: *"Sharing live · 2 links · Stop"*. Tap → manage list (label, "viewed 3×", Stop each, Stop all).
4. **Stop:** confirm only for *Stop all*; toast "Sharing stopped — links no longer work".
5. **States:** no driver yet (button disabled with hint "Available once a driver is assigned"); offline (show error + retry, no silent queue); ride ended (banner disappears; shares expire by D6).

### Public tracking page (`/t/<token>`, mobile-first)
- **Hierarchy (design review D3, map-first):** full-bleed map with a **fixed-height bottom sheet (~36% of the viewport, no drag)**. Reading order, top to bottom of the sheet: (1) **status pill with ETA** (*On the way to pickup · 4 min* / *In trip · Arriving 4:35 pm* / *Trip completed* / *Trip cancelled*), (2) **number plate as the hero** (PlateBadge style, large), (3) vehicle colour/brand/model + driver first name, (4) From → To. Sheet headline = *"Rahul is on a trip"*. Footer line: "Shared via Ocar · updates every 5 seconds".
- **Map framing:** the camera frames the driver, route and drop inside the area **above** the sheet (bottom padding = measured sheet height), so the car is never hidden under it (the bug fixed in the rider app, PR #279).
- **Motion (design review D6):** the car marker **glides** between updates over the poll interval (~5 s, linear) and rotates to its heading; it **snaps without animation** if the jump is over 300 m or the tab was hidden. "Live" is shown only as the text *"Updated 5 sec ago"* (counting up) beside the pill; **no pulsing dot**. Under `prefers-reduced-motion` the marker jumps without gliding.
- **States:** loading skeleton; live; **stale** (driver position >60 s old → dot greys, "Last seen 2 min ago"); network-error banner with auto-retry; completed; cancelled; expired/revoked ("This link is no longer active"); invalid.
- Safe by default: `noindex`, `Referrer-Policy: no-referrer`, generic OG preview ("Live trip on Ocar", no names), no analytics keyed on the token.
- **Wide screens (design review D8):** above 600 px the map fills the window and the sheet stays at the DESIGN.md **430 px** width, floating bottom-centre, with identical content. No separate desktop layout.
- **Language & scripts (design review D9):** English + Hindi + Odia, strings externalised (Odisha audience). Noto Sans Devanagari and Noto Sans Oriya are added as fallbacks, loaded per script via `unicode-range` (a justified exception to DESIGN.md's no-new-fonts rule: the brand fonts have no glyphs for these scripts); line-height 1.6 for those scripts; **no fixed-height text boxes** (the sheet grows for long strings, up to 40 % of the viewport) and the status pill may wrap to two lines. First language = `?lang=` on the link if present, else the browser language, else English; the footer switcher stores the choice in `localStorage` only.
- **Accessibility (design review D10):** status as text not colour; ≥44 px targets. The status pill and the "Last seen / Updated N sec ago" text are **one `aria-live="polite"` region that announces only when the phase or the live/stale state changes**, never on every poll. The map has `role="img"` with a text label ("Driver is about 2 km from the destination"); sheet content is real HTML text in reading order (status, plate, vehicle, route); the plate is real text, not an image. Every control (language switcher, Call 112, Share this link) is keyboard-focusable with a visible 2 px `{colors.primary}` focus ring. Text and pills meet 4.5:1 contrast against the sheet (not the map); body text ≥16 px, nothing below 12 px. QA: axe + one manual screen-reader pass.

### Interaction states (design review D4: what the viewer SEES)

| Surface / state | What is on screen |
|---|---|
| Public · loading | Skeleton sheet (pill, plate bar, two text lines) + map with a spinner; no driver dot |
| Public · live | As D3; driver dot moves; pill tone `info` (on the way) / `success` (in trip) |
| Public · stale (>60 s no update) | Dot turns grey, line "Last seen 2 min ago", pill turns `warning` tone; never shown as live |
| Public · offline / request failing | Top banner "Reconnecting…", last known data stays visible, auto-retry |
| Public · completed | Pill "Reached destination safely · 4:32 pm", drop pin, driver dot removed; page stays for 30 min after arrival (D6) |
| Public · cancelled | Pill "Trip was cancelled"; no map movement |
| Public · revoked / expired / invalid | One calm full-screen message "This link is no longer active" (identical for all three; leaks nothing) |
| Public · map cannot load (eng review D9) | Grey map area replaced by the line "Map unavailable. Status and location text below keep updating" (en/hi/or); the sheet and polling are unchanged |
| Rider · no driver yet | Share action disabled with hint "Available once a driver is assigned" |
| Rider · no saved contacts | Contacts block shows "Add a trusted contact" with an Add button beside **Share link** |
| Rider · SMS failed / DLT off | Inline "SMS not sent — share the link instead" |
| Rider · sheet reopened while sharing | Shows the existing link and shares (no duplicate created) |
| Rider · sharing active | Banner "Sharing live · N links · Stop" above the sheet |

Each string ships in English, Hindi and Odia.

### Design tokens (design review D7, all from DESIGN.md)

| Element | Tokens |
|---|---|
| Bottom sheets (rider share sheet, public page sheet) | `{rounded.3xl}` top corners, shadow `0 -6px 32px rgba(14,143,163,0.10)`, 40×4 teal 15 % handle on the rider sheet (the public sheet is fixed, no handle) |
| **Share link** | Pill primary button, `{colors.primary}`, Button Primary shadow |
| **Send SMS**, **Add a contact** | Secondary pill, `{colors.surface}` |
| Contact rows | Checkbox filled `{colors.primary}`, row background `{colors.surface-2}` |
| Sharing banner | `{colors.primary-subtle}` background, `{colors.primary-dark}` text, **Stop** as a text button in `{colors.error}`; no side-stripe border |
| Status pill tones (chip spec) | on the way = info, in trip = success, stale = warning, cancelled / completed = muted; SOS banner = `{colors.error-light}` background, `{colors.error}` text, alert icon |
| Plate | Yellow commercial IND plate as `PlateBadge` (needs a **web port**; it only exists in rider-mobile and the driver app today) |
| Fonts | Space Grotesk for the sheet headline, Plus Jakarta Sans elsewhere, plus script fallbacks (below) |
| Hard rules | No orange anywhere; all shadows teal-tinted; no gradient text; no cards inside cards |

## 5. Data model (migration 126)

```sql
CREATE TABLE ride_shares (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ride_id         BIGINT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- the sharer
  token_hash      CHAR(64) NOT NULL UNIQUE,                                 -- sha256 hex; raw token never stored
  recipient_label VARCHAR(60),                                              -- contact name; null for share-sheet links
  recipient_phone VARCHAR(15),                                              -- only when SMS'd; purged with the row
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  first_viewed_at TIMESTAMPTZ,
  last_viewed_at  TIMESTAMPTZ,
  view_count      INT NOT NULL DEFAULT 0,
  is_sos          BOOLEAN NOT NULL DEFAULT false                            -- created by an SOS press (design review D5)
);
CREATE INDEX ride_shares_ride_idx ON ride_shares (ride_id) WHERE revoked_at IS NULL;
```

Expiry is **computed**, not stored: expired when `now() > terminalAt(ride) + 30 min` or `now() > created_at + 7 days`. A cleanup job deletes shares 30 days after the ride ends (no recipient phone numbers kept). Account deletion does **not** cascade (the `users` row is kept, see `account.service.ts`), so `deleteAccount` explicitly deletes the user's shares inside its transaction (eng review D3).

## 6. API

**Authenticated (rider):**
- `POST /api/v1/rides/:id/shares` `{ contactIds?: string[] }` → creates 1 anonymous share (no contacts) or 1 per contact and sends the SMS; returns `[{id, url, label}]`. Rules: the ride is the caller's; status ∈ accepted / driver_arrived / in_progress / returning; ≤10 active shares per ride; 20 creations/hour/user.
- `GET /api/v1/rides/:id/shares` → active shares with `viewCount`, `lastViewedAt`.
- `DELETE /api/v1/rides/:id/shares/:shareId` and `DELETE /api/v1/rides/:id/shares` (stop all).

**Public (no auth):** `GET /api/v1/public/trips/:token`
- Hash → lookup. Unknown/revoked → **404** (same body); known but expired → **410**. Rate limits (eng review D5): unknown/expired-token lookups **20/min/IP** then 429 with `Retry-After`; valid-token requests **180/min/token**; no extra per-IP cap beyond the existing 600/min general limiter; Redis store via the existing `redisStore` helper.
- Data comes from a dedicated narrow query `getPublicTripRow(rideId)` mapped field by field (allow-list; eng review D6), never from the full ride row. The ETA uses a **ride-keyed** 60 s cache (not `getRoute`'s own key, which is rounded driver coordinates and misses whenever the driver moves about 11 m).
- Returns the D7 DTO plus `phase` (`driver_on_way | in_trip | completed | cancelled`), `driver {lat,lng,heading,updatedAt}`, `etaMin`, `route` (planned polyline), `serverTime`.
- `Cache-Control: no-store`. The server caches the DTO **2 s per ride** in Redis so N viewers cost one trip build plus one indexed `token_hash` lookup per poll (kept uncached so a revoke takes effect on the next poll); ETA comes from a **per-ride route call cached 60 s** (≈ one Routes call per minute of an actively viewed shared trip, ≈ ₹0.4).
- Updates `view_count` / `last_viewed_at` at most once per minute per share.

**Config:** `system_config.trip_share_enabled` kill switch (default off until DLT + QA are done).

## 7. SOS integration

The `sos_contact` SMS carries a **live link** (auto-created share, label "SOS", `is_sos = true`) instead of a static pin, and falls back to the static pin if share creation fails. Needs the template re-registered on DLT (wording change). SOS can only fire during an active ride (`sos.service.ts:23-26`), so the post-trip expiry cannot cut an SOS link short, and the SOS share appears in the rider's manage list (label "SOS") with a Stop button.

**SOS variant of the public page (design review D5):** when the share is `is_sos`, the page shows a full-width banner at the top, error tone with a text label (never colour alone): *"Rahul pressed SOS. Call them now, then call 112 if you cannot reach them."* with two 44 px buttons, **Call 112** (a `tel:` link) and **Share this link**. The rider's phone number is **not** shown (the contact already has it). The banner stays until the trip ends. Banner copy ships in English, Hindi and Odia.

### Journey storyboard (design review Pass 3, restating the accepted flows)

| Step | User does | User feels | Plan specifies |
|---|---|---|---|
| 1 | Rider taps *Share trip* | A little unsure: who will see this? | Footer text on the sheet states what recipients see and that sharing can be stopped |
| 2 | Rider picks WhatsApp / a contact | Relief, wants confirmation | OS share sheet; banner "Sharing live · N links" appears (D4) |
| 3 | Relative taps the link | Anxious, 3 seconds of patience | Map-first page, status pill, plate hero (D3) |
| 4 | Relative watches | Calmer if movement is visible, anxious if not | Moving dot, stale state turns grey with "Last seen" rather than faking live (D4) |
| 5 | Trip ends | Wants closure | "Reached destination safely · time" kept 30 min (D4) |
| 6 | SOS pressed (rare) | Scared, needs to act | SOS banner with Call 112 (D5) |

## 8. Edge cases

| Case | Behaviour |
|---|---|
| Driver app offline / GPS stale | Page greys the dot, "Last seen Xs ago"; never shows a stale position as live |
| Driver reassigned mid-share | Same link shows the new driver (D5); old driver data not retained |
| Ride has stops / round-trip return leg | Route polyline covers the current leg + remaining stops; phase stays `in_trip` |
| Rental or multi-day trip | Valid for the ride's life, 7-day cap from creation |
| Rider or driver cancels | Phase `cancelled`; expires after the 30 min grace |
| Rider revokes while a recipient has the page open | Next poll gets 404 → page shows "no longer active" within 5 s |
| Link forwarded to strangers | Possible by design (Uber is the same); mitigated by revoke, a view counter shown to the rider, and expiry |
| Token guessing | 128-bit token + rate limits + uniform 404 |
| Link-preview bots (WhatsApp) | Generic OG tags, no PII; bots must not count as views (UA filter) |
| Duplicate taps on Share | The Share button is disabled while a create request is in flight (eng review D7); caps of 10 active shares per ride and 20 creations/hour/user; a network retry can leave one extra link, visible and revocable in the manage list |
| SMS fails / DLT missing | Share still created; sheet says "SMS not sent — share the link instead" |
| Contact deleted after sharing | Existing share unaffected until revoked/expired |
| User deletes account | All their shares deleted |
| Clock skew | Page uses `serverTime` for "x ago", not the phone clock |
| Viral link / heavy polling | 2 s DTO cache + per-IP/token limits; page backs off to 15 s after 10 min |

## 9. Privacy & compliance

Recipient phone numbers are stored only for SMS shares and deleted 30 days after the ride. Consent is the rider's own act of sharing; the share sheet states what recipients see. DPDP: purpose-limited, deletable with the account. Admin can see share counts on a ride, never tokens.

## 10. Tasks

1. **Migration 126 + repository** (`ride-shares.repository.ts`): create / list / revoke / hash lookup / view bump; tests with a fake pool.
2. **Service + authenticated routes:** the rules, limits, SMS via template `trip_share`, kill switch; one unit test per rule in §6.
3. **Public endpoint + DTO builder + cache + limiter:** tests for phases, 404/410, stale flag, a test that the response keys equal the allow-list exactly with no phone / fare / OTP / payment value (eng review D6, deny-list kept as a secondary check), both limiter buckets (D5), and that a revoked link returns 404 on the next poll even while the per-ride DTO is cached.
4. **Cleanup job** (purge, as a processor registered in `partition-maintenance.worker.ts`) + explicit delete of the user's shares inside `deleteAccount` with a test (eng review D3).
5. **SOS link upgrade** (eng review D8): first add worker tests pinning the existing contact fan-out in `notifications.worker.ts:141-168` (rider-triggered only, every contact texted, one failure does not block others or the admin SMS, each attempt logged), then the link variant (one `is_sos` share per alert, same URL for all) and the fallback to the old static-pin SMS (share creation fails, flag off, template not DLT-approved).
6. **apps/user `/t/[token]` page:** all §4 states, i18n (en/hi/or), noindex/referrer headers, polling hook with back-off; component tests per state.
7. **rider-mobile:** `Share trip` action, share sheet, banner / manage list; tests for the model (which actions show when) and the sheet states.
8. **QA on staging:** two phones + a desktop browser: share while en route, while in trip, revoke, end trip, expiry, offline driver; check the WhatsApp preview.
9. **Rollout:** DLT template registration (`trip_share`, updated `sos_contact`), flag on for internal testers, then everyone. Also: referrer-restricted Maps key and a billing alert; confirm proxy/CDN access logs do not record `/public/trips/<token>`; request-log serializer redacts the token (eng review D10, with a test); a test that link-preview bots (UA filter) do not bump `view_count`/`first_viewed_at`; the page's back-off to 15 s after 10 minutes; check on staging that a real driver app posts location often enough in the background; pick the migration number at merge time (125 is the highest today).

## 11. Open questions for review

1. ~~Which map library?~~ **Resolved (design review):** `apps/user` already uses Google Maps JS through `@vis.gl/react-google-maps` (`components/map/*`). The public page reuses it; the Maps JS key must be HTTP-referrer restricted, and each page load is billed (confirm cost at expected volume).
2. ~~Show the drop address?~~ **Resolved (D11):** full pickup/drop + route with a disclosure line; hide-destination option deferred to v2.
3. ~~Post-trip grace?~~ **Resolved (D4):** keep 30 min, showing "Reached destination safely".
4. Are the rate limits and the 5 s polling interval acceptable for the expected volume?
5. Should v1 include "contact viewed your trip" (cheap, reassuring) or hold it for v2? (Plan decision D8 says v2; the rider's manage list already shows "viewed N×".)

## What already exists (design review)

- **DESIGN.md** ("The Reliable Route"): palette, type roles, 3xl bottom sheets, status pills, pill CTAs, bans. All new UI is mapped to its tokens (D7).
- **Map components** in `apps/user/components/map/` (`FitBounds`, `CarMarker`, `RecenterMap`) on `@vis.gl/react-google-maps`: reuse for the public page.
- **rider-mobile:** `RideActions` strip, bottom-sheet pattern, `PlateBadge` (`DriverIdentity.tsx`), `StatusBanner`, emergency-contacts screens.
- **Glide + settle pattern** for markers from PR #279 (`NearbyCarMarker`, `useMarkerSettled`): same approach as D6.

## NOT in scope (design review)

- Hide-destination switch per link: deferred to v2 (D11).
- "Contact viewed your trip" notification, auto-share on trip start, driver-side sharing: v2 (D8).
- A split desktop layout for the public page: not built; the 430 px sheet floats on wide screens (D8 of this review).
- Draggable public sheet: rejected for v1 (D3).
- Mockups: not generated (image API key missing); implement from the text spec and run `/design-review` on staging.
- Other languages than English / Hindi / Odia.

## Design Review Completion Summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present; 3 UI surfaces            |
  | Step 0               | 5/10; focus: all 7 dimensions               |
  | Pass 1  (Info Arch)  | 6/10 → 8/10 after fixes                     |
  | Pass 2  (States)     | 4/10 → 8/10 after fixes                     |
  | Pass 3  (Journey)    | 6/10 → 8/10 after fixes                     |
  | Pass 4  (AI Slop)    | 7/10 → 9/10 after fixes                     |
  | Pass 5  (Design Sys) | 6/10 → 9/10 after fixes                     |
  | Pass 6  (Responsive) | 4/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 1 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 0 generated (no image API key), 0 approved  |
  | Decisions made       | 9 added to plan (D3-D11)                    |
  | Decisions deferred   | 0                                           |
  | Overall design score | 4/10 → 8/10                                 |
  +====================================================================+
```

Outside design voices: unavailable (Codex has no model configured for the custom endpoint; the independent Claude design agent failed on a network error). Scores are the primary review only.

Open for the engineering review: question 4 above (rate limits and the 5 s polling interval).

### Unresolved Decisions

None from the design review.

## Implementation Tasks (design review)

- [ ] **T1 (P1, human: ~1d / CC: ~30min)**: public page: build the map-first layout with fixed ~36 % sheet, status pill, plate hero, camera framing above the sheet (D3), all states in the §4 table (D4). Files: `apps/user/app/t/[token]/*`. Verify: component test per state + manual on a 360 px phone.
- [ ] **T2 (P1, human: ~4h / CC: ~20min)**: SOS variant: `ride_shares.is_sos`, banner with Call 112 + Share this link in en/hi/or (D5). Files: migration 126, `sos.service.ts`, public page. Verify: SOS-created share renders the banner; normal share does not.
- [ ] **T3 (P2, human: ~4h / CC: ~20min)**: marker glide with snap rules, "Updated N sec ago", reduced-motion fallback (D6). Files: `apps/user/components/map/`. Verify: unit test of the interpolation rule; manual with a throttled network.
- [ ] **T4 (P2, human: ~3h / CC: ~15min)**: port `PlateBadge` to web and apply the D7 token table. Files: `apps/user/components/`. Verify: visual check against the rider app.
- [ ] **T5 (P1, human: ~4h / CC: ~20min)**: Noto Devanagari/Oriya via `unicode-range`, growing sheet, wrapping pill, `?lang=` and browser-language default (D9). Verify: render the page in hi and or on a low-end Android.
- [ ] **T6 (P2, human: ~2h / CC: ~15min)**: accessibility rules (D10) incl. one `aria-live` region that announces on state change only. Verify: axe + one manual screen-reader pass.
- [ ] **T7 (P1, human: ~1d / CC: ~30min)**: rider share sheet, contacts empty state, banner and manage list, disclosure footer (D4, D7, D11). Files: rider-mobile `ride/[id]`, new `features/trip-share/`. Verify: model tests for which actions show when; manual on an emulator.

## Eng review: decision ledger

Target: this plan (`2026-11-06-live-trip-sharing.md`). Reviewer: Claude (primary). Outside voice: see report.

### R1: Ship SMS-to-contacts in v1 or defer it
Finding: #1, INFORMATIONAL, confidence 8/10, plan §3 D1 + §4 "Send to my contacts" + §5 `recipient_phone`, Claude. Complexity gate (34 files, 2 new services).
Plan baseline: original proposal: v1 includes SMS to saved contacts via a new DLT template `trip_share`.
Runtime evidence: SMS needs a DLT-registered template per wording (`104_user_emergency_contacts.sql` comment, `notifications.worker.ts:155`); no `trip_share` template exists. The OS share sheet needs none.
Comparison grid:

| Choice | Current | A Defer SMS | B Keep SMS |
|---|---|---|---|
| R1 SMS-to-contacts in v1 | in v1 (proposal) | v2 | v1 |
| `recipient_phone`, `recipient_label` columns + 30-day phone purge | in schema | removed from v1 schema | kept |
| DLT template `trip_share` | required before rollout | not needed for v1 | required |
| Contacts list in the share sheet | in sheet | removed (Share link only) | kept |
| SOS live link (D5) | in v1, existing `sos_contact` template reworded | unchanged | unchanged |
| Other choices (structure, security, tests) | pending | pending | pending |

Question D1:
D1 — Ship SMS-to-contacts in v1, or defer it? <gstack-qid:plan-eng-review-defer-sms>
Project/branch/task: plan/live-trip-sharing, Scope Challenge (complexity gate), engineering review.
ELI10: The plan has two ways to share: the phone's own share sheet (WhatsApp, SMS, anything) and Ocar texting the rider's saved contacts itself. The second needs a new SMS wording approved by the SMS regulator (DLT), which takes days to weeks, plus extra columns that hold phone numbers and a clean-up rule for them. The first needs none of that and is how most Indians share anyway.
Stakes if we pick wrong: keeping it can delay the whole launch on a vendor approval and adds personal data to protect; deferring it means no Uber-style "text my 3 contacts" button in v1.
Recommendation: A because DLT approval is outside our control and the share sheet already reaches every contact.
Completeness: A=8/10, B=9/10
Pros / cons:
A) Defer SMS-to-contacts to v2 (recommended) (human: saves ~2 days / CC: saves ~1 hour)
  ✅ Launch no longer waits on DLT approval, and no recipient phone numbers are stored, so there is nothing extra to purge or protect.
  ❌ Riders cannot text their saved contacts from inside Ocar in v1; they pick the contact in the phone's share sheet instead.
B) Keep SMS-to-contacts in v1
  ✅ Matches the Uber/Ola flow the client pointed at, with per-contact links you can revoke and count separately.
  ❌ Blocks on DLT, adds a template, two columns, a purge rule and a contacts list to build and test.
Net: a faster, simpler v1 vs the exact big-company contact flow on day one.
Header: SMS in v1
Options:
A) Defer SMS-to-contacts to v2 (Recommended)
Remove `recipient_phone`/`recipient_label`, the contacts list in the share sheet and the `trip_share` template from v1. Links are anonymous, one per ride (share sheet only). SOS still sends its live link through the existing `sos_contact` template.
B) Keep SMS-to-contacts in v1
Keep per-contact shares, the contacts list, the `trip_share` DLT template and the phone-number purge.
State: approved
Actual answer: D1 = B) Keep SMS-to-contacts in v1 (user answer in this session)
Accepted scope: none changed; v1 keeps per-contact shares, contacts list, `trip_share` DLT template, `recipient_phone`/`recipient_label` and their purge. DLT registration stays a rollout prerequisite (the SMS path degrades to "SMS not sent, share the link instead" until approved, D4 of the design review).
History: none

### R2: File/class arrangement
Finding: #2, INFORMATIONAL, confidence 7/10, plan §10 tasks 1-9 (about 34 files, 2 new services), Claude. Complexity gate, structure question.
Plan baseline: original proposal: API module with repository, service, controller, routes, validator, a separate public-trip DTO builder and a separate purge processor; web page split into components.
Runtime evidence: repo modules follow repository/service/controller/routes/validator (e.g. `api/src/modules/emergency-contacts/`); purge jobs are branches in `partition-maintenance.worker.ts:23-31`.
Comparison grid:

| Choice | Current | A Original arrangement | B Smaller arrangement |
|---|---|---|---|
| R2 API files | not arranged | module `ride-shares/` with repository, service, controller, routes, validator, `public-trip.ts` DTO builder + a new purge processor (about 8 files) | module `ride-shares/` with repository, service, routes (handlers inline), types; DTO builder inside the service; purge as one more branch in the existing `partition-maintenance.worker.ts` (about 5 files) |
| Features and contracts | as approved (SMS kept, D3-D11 design) | identical | identical |
| Approved security / error / test / performance fixes | none yet approved | unchanged | unchanged |
| Pending remedies not decided here | | R3..: account deletion, token storage, rate limits, DTO query, duplicate shares, SOS regression | same |

Question D2:
D2 — Which file arrangement for the API work? <gstack-qid:plan-eng-review-structure>
Project/branch/task: plan/live-trip-sharing, Scope Challenge (complexity gate), engineering review. Pending remedies not decided here: account deletion, token storage, rate limits, public DTO query, duplicate shares, SOS regression.
ELI10: Same feature either way. The question is how many files it is spread over. The repo's habit is one file each for data access, logic, request handlers, routes and validation. A smaller version keeps the handlers next to the routes and reuses the existing clean-up worker instead of adding a new one.
Stakes if we pick wrong: too many tiny files slow review and hide the logic; folding things together can break the repo's convention and make the next person hunt for the handlers.
Recommendation: B because the handlers are one-liners and the purge job is a single branch in an existing worker, so a separate controller and processor file add nothing.
Completeness: A=9/10, B=9/10
Pros / cons:
A) Original arrangement (about 8 API files)
  ✅ Exactly follows the module layout every other module uses, so anyone finds the handlers where they expect them.
  ❌ A controller and a processor file that only forward calls, so more files to read for the same behavior.
B) Smaller arrangement (about 5 API files) (recommended)
  ✅ Fewer moving parts, and the purge reuses the proven partition-maintenance worker and its tests.
  ❌ Inline handlers differ from the repo's controller-file habit, so a reviewer must know this module is the exception.
Net: convention-perfect but more files vs fewer files with one small convention exception.
Header: File arrangement
Options:
A) Original arrangement
Module `ride-shares/` with repository, service, controller, routes, validator, `public-trip.ts` and a new purge processor (about 8 API files). Same features and contracts.
B) Smaller arrangement (Recommended)
Module `ride-shares/` with repository, service, routes with inline handlers and types; the DTO builder lives in the service; purge is one more branch in `partition-maintenance.worker.ts` (about 5 API files). Same features and contracts.
State: approved
Actual answer: D2 = A) Original arrangement (user answer in this session)
Accepted scope: API module `ride-shares/` with repository, service, controller, routes, validator, `public-trip.ts` DTO builder and a separate purge processor (about 8 API files); same features and contracts.
History: none

### Scope record (Scope Challenge result: scope accepted as-is)
feature answers: D1 = B (keep SMS in v1); structure: D2 = A (original arrangement); accepted scope: full plan as written plus the design-review decisions D3-D11; pending remedies: R3 account deletion, R4 token storage, R5 rate limits, R6 public DTO query, R7 duplicate shares, R8 SOS regression.

### R3: Account deletion does not remove shares
Finding: #3, CRITICAL, confidence 9/10, `api/src/modules/account/account.service.ts:11-13` ("The row itself stays: rides, payments, ledgers and settlements reference it") vs plan §5 "Account deletion cascades", Claude.
Plan baseline: original proposal: `user_id ... ON DELETE CASCADE` removes a user's shares when the account is deleted.
Runtime evidence: `deleteAccount` anonymises the users row and keeps it, so a foreign-key cascade never fires. Shares (and, with SMS kept, recipient phone numbers) would survive deletion until a purge job runs.
Comparison grid:

| Choice | Current | A Explicit delete in deleteAccount | B Purge job only |
|---|---|---|---|
| R3 shares removed at account deletion | cascade (does not fire) | `DELETE FROM ride_shares WHERE user_id = $1` inside the deleteAccount transaction | not removed until the purge job (30 days after the ride ends) |
| 30-day purge job | planned | kept as backstop | the only mechanism |
| Regression coverage | none | test: deleteAccount removes the user's shares; existing deleteAccount tests unchanged | test the purge only |
| Other choices | pending | pending | pending |

Question D3:
D3 — Remove a rider's shares when they delete their account? <gstack-qid:plan-eng-review-account-deletion>
Project/branch/task: plan/live-trip-sharing, Architecture review. Pending remedies not decided here: token storage, rate limits, public DTO query, duplicate shares, SOS regression.
ELI10: The plan says deleting an account automatically deletes its shares. But Ocar's account deletion never deletes the user row, it only blanks the personal fields (rides and payments must be kept). So the automatic delete never happens, and a deleted rider's live links and their contacts' phone numbers would stay in our database.
Stakes if we pick wrong: we break our own privacy promise and Google Play's account-deletion rule by keeping a deleted person's contacts' phone numbers.
Recommendation: A because it is one query in a transaction that already exists, and it makes the promise true immediately.
Completeness: A=10/10, B=5/10
Pros / cons:
A) Delete the user's shares inside deleteAccount (recommended) (human: ~1h / CC: ~10min)
  ✅ Links stop working and contact phone numbers are gone the moment the account is deleted, with a test that proves it.
  ❌ One more table touched by account deletion, so that function and its tests must be updated.
B) Rely on the purge job only
  ✅ No change to account deletion code.
  ❌ A deleted account's contacts' phone numbers and live links remain for up to 30 days after the ride, which breaks the privacy promise.
Net: one extra query now vs a privacy gap for weeks.
Header: Delete shares
Options:
A) Delete shares in deleteAccount (Recommended)
Add `DELETE FROM ride_shares WHERE user_id = $1` inside the existing deleteAccount transaction; keep the purge job as a backstop; add a test that deletion removes the user's shares. Existing deleteAccount behavior unchanged.
B) Purge job only
No change to deleteAccount; shares disappear only when the purge job removes them.
State: approved
Actual answer: D3 = A) Delete shares in deleteAccount (user answer in this session)
Accepted scope: add `DELETE FROM ride_shares WHERE user_id = $1` inside the existing `deleteAccount` transaction; keep the purge job as a backstop; add a test that deletion removes the user's shares; existing deleteAccount behavior unchanged. The plan's "Account deletion cascades" wording is corrected.
History: none

### R4: Token storage vs "reopen shows the existing link"
Finding: #4, CRITICAL, confidence 9/10, plan §3 D4 ("only SHA-256 stored") vs design-review D4 table row "Rider · sheet reopened while sharing: shows the existing link and shares (no duplicate created)", Claude.
Plan baseline: last approved: D4 stores only `token_hash`; design D4 requires the sheet to show the existing link on reopen.
Runtime evidence: a SHA-256 hash cannot be turned back into the URL, so the server can never return the link again after the creating request. Refresh tokens in this repo follow the same hash-only rule (CLAUDE.md Security Rules).
Comparison grid:

| Choice | Current | A Hash-only + URL kept on the rider's device | B Encrypted token on the server |
|---|---|---|---|
| R4 where the raw link lives after creation | contradicted (hash-only, yet re-shown) | only in the creating response and on the rider's device (secure storage keyed by share id) | AES-256-GCM encrypted in `ride_shares`, key in SSM |
| Reopen on the same device | shows link | shows link from device storage | shows link from the server |
| Reopen after reinstall / other device | shows link | shows the manage list (no URL); "Create a new link" button | shows link |
| Database leak exposes live links | no | no | no (needs the key too) |
| New infrastructure | none | none | encryption key in SSM + crypto helper + rotation story |
| Other choices | pending | pending | pending |

Question D4:
D4 — Where does the share link live after it is created? <gstack-qid:plan-eng-review-token-storage>
Project/branch/task: plan/live-trip-sharing, Architecture review. Pending remedies not decided here: rate limits, public DTO query, duplicate shares, SOS regression.
ELI10: To keep links safe the plan stores only a scrambled fingerprint (hash) of each link, like passwords. But the design also says that when the rider reopens the share sheet it shows the same link again. A fingerprint cannot be turned back into the link, so those two decisions contradict each other.
Stakes if we pick wrong: either the "show the existing link" screen cannot work, or we start keeping real links in the database.
Recommendation: A because it keeps the hash-only security rule used for refresh tokens, needs no new key, and the only loss is a rare cross-device case.
Completeness: A=8/10, B=9/10
Pros / cons:
A) Keep hash-only; the rider's phone remembers the link (recommended) (human: ~3h / CC: ~20min)
  ✅ A database leak reveals nothing usable, there is no new key to manage, and the common same-phone reopen works.
  ❌ After a reinstall or on a second phone the rider sees the share list without the link and must create a new one.
B) Store the link encrypted on the server
  ✅ The link can always be shown again, on any device.
  ❌ Adds an encryption key, a crypto helper and a rotation plan, for a case that rarely happens.
Net: simple and safe with a rare cross-device gap vs full convenience with a key to manage.
Header: Link storage
Options:
A) Hash-only, link kept on the device (Recommended)
Server keeps only `token_hash`. The rider app stores each created URL in secure storage keyed by share id and shows it on reopen; without it the sheet lists shares (label, views, Stop) and offers "Create a new link".
B) Encrypted token on the server
Store the token encrypted (AES-256-GCM, key in SSM) so the server can return the URL again; adds a key, crypto helper and rotation plan.
State: approved
Actual answer: D4 = A) Hash-only, link kept on the device (user answer in this session)
Accepted scope: server keeps only `token_hash`; rider-mobile stores each created URL in secure storage keyed by share id and shows it when the sheet is reopened; without a stored URL the sheet lists shares (label, views, Stop) and offers "Create a new link". The design-review row "sheet reopened while sharing shows the existing link" applies on the creating device.
History: none

### R5: Rate limiting of the public endpoint (open question 4)
Finding: #5, INFORMATIONAL, confidence 7/10, plan §6 ("60/min/IP and 120/min/token", 5 s polling) vs `api/src/middleware/rateLimit.middleware.ts:95-106` (`generalLimiter` 600/min keyed by `principalKey`, Redis store), Claude.
Plan baseline: last proposal: 60 requests/min/IP and 120 requests/min/token for `GET /public/trips/:token`; viewers poll every 5 s (12 requests/min each).
Runtime evidence: the API sits behind one proxy hop (`trust proxy 1`, `app.ts:50`), so limits key on the real client IP. Indian mobile carriers put many phones behind one IP; an office has many relatives behind one IP. Unknown tokens are the only abuse that matters (128-bit tokens cannot be guessed, but scanning must stay cheap to refuse).
Comparison grid:

| Choice | Current | A Limit the misses, generous on valid | B Plan as written |
|---|---|---|---|
| R5 unknown/expired token lookups | counted in the 60/min/IP total | 20 per minute per IP, then 429 with Retry-After | counted in the 60/min/IP total |
| Valid-token requests | 60/min/IP total, 120/min/token | 180/min per token (15 viewers at 5 s); no per-IP cap beyond the existing 600/min general limiter | 60/min/IP total, 120/min/token |
| Store | n/a | Redis (`rl:pubmiss:`, `rl:pubtok:`) using the existing `redisStore` helper | Redis, same helper |
| Behavior behind shared IPs (carrier NAT, office) | not specified | 5+ viewers sharing an IP all keep working | the 6th viewer on one IP gets 429 |
| Other choices | pending | pending | pending |

Question D5:
D5 — How should the public tracking endpoint be rate limited? <gstack-qid:plan-eng-review-public-rate-limit>
Project/branch/task: plan/live-trip-sharing, Performance and security review. Pending remedies not decided here: public DTO query, duplicate shares, SOS regression.
ELI10: Anyone on the internet can call the public page's data endpoint. The plan caps it at 60 requests a minute per IP address. But each open page asks every 5 seconds (12 a minute), and many phones or a whole office share one IP address, so five relatives behind one IP would already hit the cap and see the page break. The thing we really want to stop is someone trying lots of wrong links.
Stakes if we pick wrong: real relatives get "too many requests" during an emergency, or scanners get cheap guesses.
Recommendation: A because it blocks guessing (misses) hard and leaves real viewers alone.
Completeness: A=9/10, B=6/10
Pros / cons:
A) Strict on misses, generous on valid links (recommended) (human: ~3h / CC: ~20min)
  ✅ Scanners are cut off after 20 wrong tries a minute, while 15 relatives can watch one trip even from the same office or carrier IP.
  ❌ Two limiter buckets to build and tune instead of one.
B) Keep the plan as written (60/min/IP, 120/min/token)
  ✅ One simple number that is easy to explain.
  ❌ Six relatives behind one IP can lock each other out in the exact moment the page matters.
Net: two small buckets that match the real abuse vs one blunt cap that blocks real families.
Header: Rate limits
Options:
A) Strict on misses, generous on valid (Recommended)
Unknown/expired-token lookups: 20/min/IP then 429 with Retry-After. Valid-token requests: 180/min/token. No extra per-IP cap beyond the existing 600/min general limiter. Redis store via the existing helper; tests for both buckets.
B) Keep the plan as written
60 requests/min/IP and 120 requests/min/token on the public endpoint.
State: approved
Actual answer: D5 = A) Strict on misses, generous on valid (user answer in this session)
Accepted scope: unknown/expired-token lookups limited to 20/min/IP then 429 with Retry-After; valid-token requests 180/min/token; no extra per-IP cap beyond the existing 600/min general limiter; Redis store via the existing `redisStore` helper (`rl:pubmiss:`, `rl:pubtok:`); tests for both buckets. Replaces "60/min/IP and 120/min/token" in §6; open question 4 is resolved.
History: none

### R6: How the public response is built
Finding: #6, CRITICAL, confidence 8/10, plan §6/§10 task 3 ("DTO builder ... deny-list test that the DTO never contains phone / fare / OTP fields") vs `api/src/modules/rides/rides.repository.ts:790-806` (`RIDE_SELECT_SQL` joins users, drivers, fare_snapshots, rate_cards, ride_cancellations, ratings, driver_vehicles, payments, locations), Claude.
Plan baseline: last proposal: build the public DTO from the full ride row and prove with a deny-list test that sensitive fields are absent.
Runtime evidence: the full ride query returns fare, payment, rating, phone and OTP-adjacent columns. A deny-list only protects the fields someone remembered to list; a new column added to that query later would leak into the public page unless the list is updated. The query also joins about 13 tables on every cache miss.
Comparison grid:

| Choice | Current | A Narrow query + allow-list | B Reuse full ride row + deny-list |
|---|---|---|---|
| R6 source of public data | full ride row (proposal) | a dedicated `getPublicTripRow(rideId)` selecting only needed columns from rides, driver (first name), vehicle, location snapshot, stops | `getRideById` result, remove fields in the mapper |
| What protects privacy | deny-list test | allow-list mapper (every output field listed explicitly) + test that the response keys equal the allow-list exactly | deny-list test of known sensitive fields |
| A column added to the ride query later | could appear in the page | cannot appear (not selected, not mapped) | appears unless the deny-list is updated |
| Cost per cache miss | about 13 joins | about 4 joins | about 13 joins |
| Other choices | pending | pending | pending |

Question D6:
D6 — Build the public page's data from a narrow query? <gstack-qid:plan-eng-review-public-dto-query>
Project/branch/task: plan/live-trip-sharing, Code quality and security review. Pending remedies not decided here: duplicate shares, SOS regression.
ELI10: The public page must never show fares, phone numbers or payment details. The plan builds the page's data from the full ride record and then removes the secret fields, with a test checking a list of forbidden fields. That only works as long as someone remembers to extend the list whenever a new column is added to the ride query; one miss leaks to anyone with the link.
Stakes if we pick wrong: a future change to the ride query silently puts a private field on a public, unauthenticated page.
Recommendation: A because it is safe by construction: only fields we list can ever appear, and it is also cheaper.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Dedicated narrow query + allow-list mapper (recommended) (human: ~3h / CC: ~15min)
  ✅ A new ride column can never reach the public page, and the lean query is faster on every cache miss.
  ❌ One more query to maintain that overlaps with the full ride query's joins for vehicle and driver name.
B) Reuse the full ride row and strip fields
  ✅ Less new SQL, reuses the existing joins and mapping.
  ❌ Protection depends on a forbidden-field list staying complete forever, on a public page.
Net: safe-by-construction with one extra query vs reuse with a leak risk that grows over time.
Header: Public data source
Options:
A) Narrow query + allow-list (Recommended)
Add `getPublicTripRow(rideId)` selecting only needed columns; map output field by field; test that the response keys equal the allow-list exactly (and that no fare/phone/OTP/payment value appears). The deny-list test becomes a secondary check.
B) Full ride row + deny-list
Build the DTO from `getRideById` and remove sensitive fields; deny-list test only.
State: approved
Actual answer: D6 = A) Narrow query + allow-list (user answer in this session)
Accepted scope: add `getPublicTripRow(rideId)` selecting only the columns the public page needs (ride status/timestamps, origin/destination labels and coordinates, stops, driver first name, vehicle colour/brand/model/plate, driver location snapshot); map output field by field; test that the response keys equal the allow-list exactly and that no fare/phone/OTP/payment value appears; the deny-list test stays as a secondary check.
History: none

### R7: Duplicate shares from double taps and retries
Finding: #7, INFORMATIONAL, confidence 7/10, plan §8 row "Duplicate taps on Share: idempotent per (ride, user) for anonymous links within 10 min" vs approved D4 (hash-only, URL kept on the device), Claude.
Plan baseline: last proposal: anonymous links are idempotent per (ride, user) for 10 minutes.
Runtime evidence: with only `token_hash` stored (D4), the server cannot return an existing link's URL on a repeated call, so a server-side "return the existing one" cannot work without also caching the URL. Reopening the sheet on the same phone does not call create at all (it shows the stored URL). Duplicates can only come from a double tap or a retried request; each extra link is separately listed and revocable, and there is a cap of 10 active shares per ride and 20 creations per hour per user.
Comparison grid:

| Choice | Current | A Server-side idempotency | B Client guard + cap |
|---|---|---|---|
| R7 repeat create calls | idempotent 10 min (cannot work with hash-only) | client sends an Idempotency-Key per tap; server keeps the response (with the URL) 2 minutes in Redis and replays it | no server idempotency; the Share button is disabled while the request is in flight; cap 10 per ride and 20/hour/user remain |
| Raw link held by the server | no | for 2 minutes in Redis | never |
| Worst case | duplicate silently created | none | one extra revocable link in the list after a network retry |
| Other choices | pending | pending | pending |

Question D7:
D7 — How should repeated Share taps be handled? <gstack-qid:plan-eng-review-duplicate-shares>
Project/branch/task: plan/live-trip-sharing, Code quality review. Pending remedies not decided here: SOS regression.
ELI10: If the rider double-taps Share, or the phone retries after a bad connection, the server could create two links. The plan said "return the same link", but we decided the server never keeps the real link (only a fingerprint), so it cannot hand the same link back.
Stakes if we pick wrong: either extra complexity (and the real link kept in Redis for a couple of minutes) to avoid a harmless duplicate, or an occasional second link in the list.
Recommendation: B because a duplicate link is harmless and visible, and the button guard removes the common case.
Completeness: A=9/10, B=8/10
Pros / cons:
A) Server-side idempotency key with a 2-minute response cache
  ✅ A retried request returns exactly the same link, so no duplicates at all.
  ❌ The raw link sits in Redis for 2 minutes and the client and server need a new header and a cache path to build and test.
B) Client in-flight guard + existing caps (recommended) (human: ~30min / CC: ~5min)
  ✅ No new server mechanism and the raw link is never held by the server; the common double tap is blocked by the disabled button.
  ❌ After a network retry the rider may see one extra link in the manage list, which they can stop with one tap.
Net: perfect de-duplication with a short-lived stored link vs a rare harmless extra link.
Header: Repeat taps
Options:
A) Server-side idempotency
Idempotency-Key header per tap; server replays the response (including the URL) from Redis for 2 minutes.
B) Client guard + caps (Recommended)
Disable the Share button while a create request is in flight; keep the cap of 10 active shares per ride and 20 creations/hour/user; drop the "idempotent for 10 minutes" rule from §8.
State: approved
Actual answer: D7 = B) Client guard + caps (user answer in this session)
Accepted scope: the Share button is disabled while a create request is in flight; caps stay at 10 active shares per ride and 20 creations/hour/user; the "idempotent for 10 minutes" rule in §8 is dropped; the server never holds the raw link after the creating response.
History: none

### R8: Regression contract for the SOS contact messages (IRON RULE)
Finding: #8, CRITICAL, confidence 9/10, `api/src/jobs/workers/notifications.worker.ts:141-168` (SOS fan-out to the rider's emergency contacts), plan §7 (SOS live link), Claude.
Plan baseline: last proposal: the `sos_contact` SMS carries a live link and falls back to the static pin if share creation fails; no regression tests specified.
Runtime evidence: the fan-out loop texts every saved contact a static map pin; it runs only when the rider pressed SOS (`triggeredByRole === 'user'`, line 144), logs each contact (`logNotification`/`markSent`/`markFailed`), and is best effort per contact so one failure never blocks the others or the admin SMS (lines 141-143, 160-167). No test file mentions `sos_contact` (`grep` over `api/tests` and `api/src`), so none of this behavior is pinned today.
Comparison grid:

| Choice | Current | A Pin existing behavior, then change | B Test only the new behavior |
|---|---|---|---|
| R8 behavior preserved | untested | a worker test first pins: rider-triggered only; every contact texted; one failing contact does not stop the rest or the admin SMS; each attempt logged sent/failed | not pinned |
| Intentional change | none | contact SMS carries a live link: one `is_sos` share created per SOS alert, same URL in every contact's SMS (label "SOS") | same |
| Fallback | none | share creation fails or `trip_share_enabled` is off or the reworded template is not DLT-approved yet: the old static-pin SMS is sent exactly as today | fallback tested only when share creation fails |
| Acceptance assertions | none | tests for all of the above, written before the change | new-behavior assertions only |
| Other choices | pending | pending | pending |

Question D8:
D8 — How do we protect the existing SOS texts to contacts while changing them? <gstack-qid:plan-eng-review-sos-regression>
Project/branch/task: plan/live-trip-sharing, Test review (regression rule). No other pending remedies.
ELI10: When a rider presses SOS, Ocar texts their saved contacts a map pin. The plan changes that text to carry the live link. This is the most safety-critical message in the app, and right now no test pins how it behaves (who gets it, what happens when one number fails). Changing it without that safety net risks breaking the one message that must always go out.
Stakes if we pick wrong: a bug in the new link code could stop SOS texts reaching family in a real emergency, and nobody would notice until then.
Recommendation: A because the iron rule says to protect behavior that is at risk, and it costs only a few tests.
Completeness: A=10/10, B=6/10
Pros / cons:
A) Pin the existing behavior first, then add the new (recommended) (human: ~3h / CC: ~20min)
  ✅ Any change that stops a contact from being texted, or lets one failure block others, fails a test before it ships.
  ❌ Writes tests for old behavior that is not changing, which is extra work now.
B) Test only the new link behavior
  ✅ Less test code and the focus stays on the new feature.
  ❌ The existing "every contact gets texted, failures don't block" behavior stays unprotected while we edit that loop.
Net: a few extra tests now vs an unprotected emergency path.
Header: SOS regression
Options:
A) Pin existing behavior first (Recommended)
Add worker tests that pin: only rider-triggered SOS texts contacts; every saved contact is texted; one failing contact does not stop the others or the admin SMS; each attempt is logged sent or failed. Then add: link variant (one `is_sos` share per alert, same URL for all) and fallback to the old static-pin SMS when share creation fails, the flag is off or the template is not approved. Tests are written before the code change.
B) Test only the new behavior
Add tests for the link variant and its fallback only.
State: approved
Actual answer: D8 = A) Pin existing behavior first (user answer in this session)
Accepted scope: before changing `notifications.worker.ts:141-168`, add worker tests that pin: only rider-triggered SOS texts contacts; every saved contact is texted; one failing contact does not stop the others or the admin SMS; each attempt is logged sent or failed. Then add: one `is_sos` share per SOS alert with the same URL in every contact's SMS, and the fallback to the old static-pin SMS when share creation fails, `trip_share_enabled` is off or the reworded template is not DLT-approved. Tests are written before the code change.
History: none

### R9: Map fails to load on the public page
Finding: #9, INFORMATIONAL, confidence 7/10, design-review state table (D4: no row for a map that cannot load) vs `apps/user/components/map/FitBounds.tsx:4` (map via `@vis.gl/react-google-maps`, needs the Maps JS script and a valid referrer-restricted key), Claude.
Plan baseline: last approved: the state table covers loading, live, stale, offline, completed, cancelled and dead links; it has no row for the map script being blocked, the key being rejected or a quota error.
Runtime evidence: Google Maps JS fails silently as a grey box when the key is restricted wrongly, quota is exceeded, or the script is blocked by the viewer's network. The sheet text (status, plate, route labels) would still render but the viewer sees an unexplained grey area.
Comparison grid:

| Choice | Current | A Add a map-unavailable state | B Leave as is |
|---|---|---|---|
| R9 map cannot load | unspecified | grey map area replaced by a calm line "Map unavailable. Status and location text below keep updating", sheet unchanged, polling continues | grey box |
| Extra work | none | one state + one string in en/hi/or + a test that simulates a load error | none |
| Other choices | none pending | none pending | none pending |

Question D9:
D9 — What does the public page show if the map cannot load? <gstack-qid:plan-eng-review-map-fallback>
Project/branch/task: plan/live-trip-sharing, Failure-mode review. No other pending remedies.
ELI10: The page's map comes from Google. If the key is misconfigured, the quota runs out, or the viewer's network blocks Google, the map area just turns grey with no explanation, on the one screen a worried relative is staring at. The text below (status, plate, route) still works.
Stakes if we pick wrong: the viewer thinks the whole page is broken and gives up, even though the status and ETA are still updating.
Recommendation: A because it is one small state that keeps the page useful when the map fails.
Completeness: A=9/10, B=5/10
Pros / cons:
A) Show a "Map unavailable" line and keep the text updating (recommended) (human: ~1h / CC: ~10min)
  ✅ The viewer understands what happened and can still read the status, ETA and plate.
  ❌ One more state and string to translate and test.
B) Leave the grey box
  ✅ Nothing to build or translate.
  ❌ An unexplained grey area on a safety page looks broken.
Net: a small state vs a confusing blank map.
Header: Map fallback
Options:
A) Show "Map unavailable" (Recommended)
Replace the grey map area with the line "Map unavailable. Status and location text below keep updating" (en/hi/or); the sheet and polling are unchanged; add a test that simulates a map load error.
B) Leave as is
No special state for a map load failure.
State: approved
Actual answer: D9 = A) Show "Map unavailable" (user answer in this session)
Accepted scope: the public page replaces the grey map area with "Map unavailable. Status and location text below keep updating" (en/hi/or) when the map cannot load; sheet and polling unchanged; a test simulates a map load error. Added to the §4 state table.
History: none

Approval readiness: PASS (R1 D1, R2 D2, R3 D3, R4 D4, R5 D5, R6 D6, R7 D7, R8 D8, R9 D9 each cite their own actual answer in this session; no accepted remedy lacks an answer).

### R10: Tokens in request logs (outside voice finding 2)
Finding: #15 (outside voice), CRITICAL, confidence 8/10, `api/src/app.ts:60-83` (`pinoHttp` with `serializeReq`; the comment at 74-79 records that the request URL is logged and shipped to Grafana Cloud) vs plan §6 (`GET /api/v1/public/trips/:token`) and the web path `/t/<token>`, Claude subagent (outside voice), verified by Claude.
Plan baseline: last proposal: tokens are 128-bit and stored hashed; nothing says they are kept out of logs.
Runtime evidence: the HTTP request log carries the request URL, which would contain the raw token for every public poll (every 5 s per viewer); logs ship to Grafana Cloud (Loki, 14-day retention) and to S3 (190-day archive). The metrics label uses the route pattern, not the URL (`observability/metrics.ts:12`). No Sentry in the API. The reverse proxy's access log setting is unknown.
Comparison grid:

| Choice | Current | A Redact the token | B Keep as is | C Investigate first | D Defer |
|---|---|---|---|---|---|
| R10 token in app request logs | logged in full | the path segment after `/public/trips/` is replaced by `:token` in the request log serializer, with a test | logged in full | find every log sink (proxy, Alloy, S3, CDN), then decide | decide after v1 |
| Token in the web page URL (`/t/<token>`) | not logged by our API | unchanged | unchanged | unchanged | unchanged |
| Reverse-proxy / CDN access logs | unknown | listed as a rollout check (cannot be redacted in code) | unchanged | covered by the investigation | unchanged |
| Other choices | none pending | none pending | none pending | none pending | none pending |

Question D10:
D10 — Keep the raw share token out of our request logs? <gstack-qid:plan-eng-review-token-in-logs>
Project/branch/task: plan/live-trip-sharing, outside-voice finding (cross-model tension). No other pending remedies.
ELI10: The share link contains a secret token, and the public data request puts it in the URL. Ocar logs every request URL, and those logs are copied to Grafana Cloud and an S3 archive for months. So anyone who can read the logs could open anyone's live trip, which defeats the point of storing only a fingerprint of the token.
Stakes if we pick wrong: live-trip links sit readable in our logs for up to 190 days.
Recommendation: A because it is a small, testable change in the existing log serializer and removes the biggest exposure.
Pros / cons:
A) Redact the token in request logs (recommended) (human: ~2h / CC: ~15min)
  ✅ Raw tokens never reach Grafana or the S3 archive, and a test keeps it that way.
  ❌ Proxy or CDN access logs outside our code still need a manual check at rollout.
B) Keep the current logging
  ✅ No change, and full URLs stay useful when debugging.
  ❌ Live-trip links are stored readable in logs for months, which contradicts the hash-only design.
C) Investigate every log sink before choosing
  ✅ Finds the proxy and CDN logs too before any change.
  ❌ Delays a one-line fix and approves nothing by itself.
D) Defer this change only
  ✅ Keeps v1 scope unchanged.
  ❌ Leaves the exposure open at launch.
Net: one small redaction vs links stored in plain text in logs.
Header: Token in logs
Options:
A) Redact the token (Recommended)
Replace the path segment after `/public/trips/` with `:token` in the request log serializer (`observability/http-log.ts`), with a unit test; add a rollout check that proxy/CDN access logs do not record it.
B) Keep as is
No change to request logging.
C) Investigate first
Bounded to listing every log sink (proxy, Alloy, S3, CDN) and reporting; approves no change.
D) Defer
Leave logging unchanged for v1; this row stays unresolved.
State: approved
Actual answer: D10 = A) Redact the token (user answer in this session)
Accepted scope: the request log serializer (`api/src/observability/http-log.ts`) replaces the path segment after `/public/trips/` with `:token`, with a unit test; a rollout check confirms proxy/CDN access logs do not record it.
History: none

Approval readiness: PASS (R1-R10 each cite their own actual answer in this session; supersedes the earlier line).

### Outside voice (Claude subagent via the Plan agent type, completed inside the 5-minute limit)
Codex: unavailable (no model configured for the custom endpoint; no call made). Native fallback findings and dispositions:
1. SOS link ownership/expiry: partly incorrect. SOS only fires during an active ride (`sos.service.ts:23-26`), so the post-trip expiry cannot cut it short, and the SOS share is listed in the manage list with Stop. Corrected in §7. No choice needed.
2. Token in logs: confirmed; accepted via D10 A.
3. Cost model wording: confirmed; §6 sentence corrected (one trip build plus one indexed token lookup per poll). No behavior change.
4. Maps/Routes budget: noted; billing alert and referrer restriction added to rollout. A static-image fallback was not adopted (no request, extra scope).
5. Position freshness: `heading` and `recorded_at` exist (`rides.repository.ts:130-146`); background posting frequency is unverified and the approved 60 s stale state covers it. Verify on staging with a real driver.
6. Scope: the reviewer recommends a smaller v1. The user kept SMS in v1 (D1 B), so that decision stands; recorded as a disagreement.
7. Plan wording and untasked items: stale sentences fixed; UA filter for preview bots and the 15 s back-off are now tasks.
8. Migration number: pick at merge time (125 is the highest today).
9. 410 vs 404: kept (a token holder learning "expired" is acceptable; the page shows one message).
10. 7-day cap on multi-day rentals: accepted; rentals are shorter than 7 days today.

## Eng review: findings, tests and outputs

**Step 0 result:** scope accepted as-is (MODE FULL_REVIEW). Pending remedies: none.

### Phase mapping (factual correction, finding #10, INFORMATIONAL, confidence 9/10)
`api/src/db/migrations/002_enums.sql:62-65` plus `075_ride_status_returning.sql:14` give the statuses `requested, accepted, driver_arrived, in_progress, returning, completed, cancelled, no_drivers`; the plan's §6 listed four phases without a mapping. Mapping used by the public endpoint: `accepted`, `driver_arrived` → `driver_on_way`; `in_progress`, `returning` → `in_trip`; `completed` → `completed`; `cancelled`, `no_drivers` → `cancelled`; `requested` → not shareable (create is refused, existing links show the inactive page). Hand-synced risk: keep this mapping in one function with a unit test over every enum value.

### 1. Architecture review
Two shapes: (A, chosen and approved in D2) one `ride-shares` module that owns shares, the authenticated router, the public router and the DTO builder; (B) a separate `public-trip` read-model module that only reads through a token-lookup function exported by `ride-shares`. B hides the DTO and limiter behind a smaller surface but splits one feature across two modules for about five files; A keeps one owner for the share state. Red flags screened: shallow module (no), information leakage (the phase mapping lives in one function), temporal decomposition (no), pass-through (the controller file is thin by the approved D2=A, accepted), split ownership (shares are written only by `ride-shares`; SOS calls its service), two ways to one task (one creation function for anonymous, per-contact and SOS shares), importable internals (n/a), hand-synced list (the status→phase table, covered by the enum test above).

Findings: #3 (D3) account deletion does not cascade, CRITICAL 9/10; #4 (D4) hash-only vs re-show contradiction, CRITICAL 9/10; #5 (D5) rate limiting would lock out families behind shared IPs, INFORMATIONAL 7/10; #10 phase mapping, INFORMATIONAL 9/10.
Dispositions: #3 accepted (D3 A); #4 accepted (D4 A); #5 accepted (D5 A); #10 accepted as factual correction.

```
 rider app ──POST /rides/:id/shares──▶ ride-shares.routes ─▶ service ─▶ repository ─▶ ride_shares
   │                                       │ (caps 10/ride, 20/h, flag, ownership, status)         ▲
   │ URL kept in secure storage            ▼                                                       │ hash lookup
 relative ──GET /public/trips/:token──▶ public limiter (misses 20/min/IP, 180/min/token)           │
                                           ▼                                                       │
                                   token hash ─▶ service.getPublicTrip ─▶ Redis DTO cache (2 s, per ride)
                                                      │ miss                    ▲
                                                      ▼                         │ ETA cache 60 s per ride
                                         getPublicTripRow (narrow query) ─▶ allow-list mapper
 SOS press ─▶ notifications.worker ─▶ create is_sos share ─▶ sos_contact SMS (fallback: static pin)
 deleteAccount ─▶ DELETE ride_shares WHERE user_id        purge job ─▶ shares 30 days after ride end
```

### 2. Code quality review
Findings: #6 (D6) public DTO from the full ride row, CRITICAL 8/10; #7 (D7) duplicate creates cannot be made idempotent with hash-only storage, INFORMATIONAL 7/10. Shared-code: reuse `redisStore` (`rateLimit.middleware.ts`), the `partition-maintenance.worker.ts` job pattern, `getRoute`, `renderTemplate` + `sendSms`; no new extraction is proposed (the `PlateBadge` web port is a third visual copy after rider-mobile and driver; `packages/mobile-shared` is React Native only, so no practical shared contract exists).
Dispositions: #6 accepted (D6 A); #7 accepted (D7 B).

### 3. Test review
```
CODE PATHS                                                      USER FLOWS
[+] ride-shares.service (create)                                [+] Rider shares a trip
  ├── [GAP] refuses ride not owned / wrong status / requested     ├── [GAP] [→E2E] create → public GET → revoke → 404
  ├── [GAP] caps 10/ride, 20/h/user, flag off                     ├── [GAP] Double tap (button guard)
  ├── [GAP] per-contact SMS: sent, failed, DLT missing            └── [GAP] Reopen sheet (URL from secure storage / missing)
  └── [GAP] token generated, only hash stored                   [+] Relative opens the link
[+] public endpoint                                               ├── [GAP] [→E2E] phases: on way, in trip, completed, cancelled
  ├── [GAP] phase mapping over every ride_status value            ├── [GAP] stale position > 60 s
  ├── [GAP] 404 unknown/revoked, 410 expired, 7-day cap           ├── [GAP] map cannot load (D9)
  ├── [GAP] allow-list keys exact; no fare/phone/OTP/payment      └── [GAP] link no longer active
  ├── [GAP] limiter: 20 misses/min/IP, 180/min/token
  └── [GAP] revoked returns 404 even with the DTO cached
[+] SOS fan-out (notifications.worker.ts:141-168)               [+] SOS
  ├── [GAP] existing: rider-triggered only (D8)                   └── [GAP] [→E2E] SOS press → contacts get live link, fallback static pin
  ├── [GAP] existing: every contact texted, failures isolated
  └── [GAP] new: one is_sos share, same URL; fallback cases
[+] deleteAccount                                               [+] Account deletion
  └── [GAP] removes the user's shares (D3)                        └── [GAP] links die immediately
[+] purge job                                                   LLM/eval: none
  └── [GAP] deletes shares 30 days after ride end, keeps recent

COVERAGE: 0/20 paths tested (all new or unpinned today)  |  GAPS: 20 (3 E2E)  |  none are proposals that fail the value bar
QUALITY: n/a (nothing exists yet)
```
Every gap above is carried into the plan's tests (§10) as the required proof of approved behavior; the SOS rows are the iron-rule regression contract (D8). Finding #11, INFORMATIONAL 8/10: no test pins the SOS fan-out today (`grep sos_contact` over `api/tests` and `api/src` finds only the worker and migration). Disposition: accepted via D8.
Test plan artifact: written to the gstack state directory for `/qa` (path in the report below).

### 4. Performance review
- #12 INFORMATIONAL 8/10: the public endpoint does one indexed lookup on `token_hash` per poll (about 12/min per viewer), then serves a 2 s per-ride cached DTO; scale unknown (viewers per trip). Disposition: accepted as is; revisit with a short token-row cache only if p95 of that lookup becomes visible in the existing `http_request_duration_seconds` metric.
- #13 INFORMATIONAL 8/10: `getRoute` caches on rounded driver coordinates (`redis-keys.ts:77-86`, 4 decimals), so the ETA would miss almost every poll; the plan now specifies a ride-keyed 60 s cache. Disposition: accepted as a correction to the approved 60 s behavior.
- #14 INFORMATIONAL 5/10 (medium confidence, price unverified): each public page load is a Google Maps JS load. Disposition: accepted; add a billing alert and a referrer-restricted key in rollout.
- Memory: the DTO cache holds one small JSON per active shared ride for 2 s. Bounded.

### Failure modes
| Path | Realistic failure | Test / handling | User sees | Critical gap? |
|---|---|---|---|---|
| Create share | DB error | 5xx with a safe message, button re-enabled | "Could not create the link, try again" | no |
| Public GET | Redis down | limiter store `passOnStoreError: true`, DTO built from DB | page works, slower | no |
| Public GET | token scan | 20 misses/min/IP then 429 | scanner blocked | no |
| SOS fan-out | share creation fails | fallback to static pin (D8 tests) | contact still gets a pin | no |
| deleteAccount | share delete fails | inside the transaction, whole deletion rolls back and retries | error, nothing half-deleted | no |
| Purge job | job fails | next run retries; shares are inert after expiry | none | no |
| Public page | map cannot load | "Map unavailable" state (D9) | clear text | no |
Critical gaps: 0.

### NOT in scope (eng review)
Hide-destination switch, viewed-by notification, auto-share, driver-side sharing (design D8/D11); a server-encrypted token for cross-device re-show (D4 B); server-side idempotency keys (D7 A); a short Redis cache of the token row (revisit on metrics).

### What already exists (eng review)
`redisStore` rate-limit helper, `partition-maintenance.worker.ts` purge pattern, `getRoute`, `renderTemplate` + `sendSms`, `user_emergency_contacts`, `sendSms`/notification logging, `apps/user` map components, `PlateBadge` (rider-mobile and driver).

### TODOS.md updates
None proposed: every deferred item is already a recorded user decision in this plan (design D8, D11; eng D4, D7), so no new TODO needs a separate answer.

### Worktree parallelization strategy
| Step | Modules touched | Depends on |
|---|---|---|
| API: migration, ride-shares module, public endpoint, limiter | `api/src/modules/ride-shares`, `api/src/db/migrations`, `api/src/middleware` | none |
| SOS link + worker tests, deleteAccount, purge job | `api/src/jobs`, `api/src/modules/account`, `api/src/modules/safety` | API (ride-shares service) |
| Public page | `apps/user` | API contract only |
| Rider app | `apps/rider-mobile` | API contract only |
Lane A: API → SOS/account/purge. Lane B: public page (against the contract, with fixtures). Lane C: rider app. Launch A + B + C together; merge A first, then B and C; QA on staging last. Conflict flag: none shared except the API response types (define them in the plan's §6 first). Three PRs (API, public page, rider app), each independently shippable behind `trip_share_enabled`.

## Eng review: implementation tasks
- [ ] **E1 (P1, human: ~1d / CC: ~30min)**: API: migration 126 + `ride-shares` module (repository, service, controller, routes, validator, `public-trip.ts`), caps, flag, phase mapping with an enum test. Surfaced by: Architecture #4/#10. Verify: unit + integration tests in §10.
- [ ] **E2 (P1, human: ~3h / CC: ~20min)**: public endpoint `getPublicTripRow` + allow-list mapper + exact-keys test (D6). Verify: keys equal allow-list; revoked returns 404 with a cached DTO.
- [ ] **E3 (P1, human: ~3h / CC: ~20min)**: public limiter with two Redis buckets (D5). Verify: 21st miss gets 429; 15 viewers on one token keep working.
- [ ] **E4 (P1, human: ~1h / CC: ~10min)**: `deleteAccount` deletes the user's shares inside its transaction + test (D3).
- [ ] **E5 (P1, human: ~3h / CC: ~20min)**: SOS: worker tests pinning the existing fan-out first, then link variant + fallback (D8).
- [ ] **E6 (P2, human: ~3h / CC: ~20min)**: rider app: device-stored URL per share id, reopen behavior, "Create a new link", button in-flight guard (D4, D7).
- [ ] **E7 (P2, human: ~1h / CC: ~10min)**: public page "Map unavailable" state + test (D9).
- [ ] **E8 (P3, human: ~1h / CC: ~10min)**: rollout: referrer-restricted Maps key, billing alert, DLT registration, flag on for testers.

- [ ] **E9 (P1, human: ~2h / CC: ~15min)**: request-log serializer redacts the share token (D10) + unit test; rollout check of proxy/CDN access logs. Files: `api/src/observability/http-log.ts`. Verify: a logged `/api/v1/public/trips/<token>` line shows `:token`.

### Unresolved decisions
None in this review.

## Eng Review Completion Summary
- Step 0: Scope Challenge: scope accepted as-is (D1 kept SMS, D2 kept the original arrangement)
- Reality rows: 7/7 applicable rows emitted, 1 unverified premise (Google Maps JS per-load price)
- Architecture Review: 4 issues found (#3, #4, #5, #10)
- Code Quality Review: 2 issues found (#6, #7)
- Test Review: diagram produced, 20 gaps identified (all new or unpinned behavior; 3 end-to-end)
- Performance Review: 3 issues found (#12, #13, #14)
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed (every deferral is already a recorded decision)
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Codex unavailable (no model configured); native Claude fallback completed with 10 findings, 1 new decision (D10 token in logs), the rest corrections, notes or recorded disagreements
- Parallelization: 3 lanes, 3 parallel / 0 sequential
- Lake Score: 3/9 (answers picking a 10/10 option over answers scored for Completeness)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude fallback (Plan agent); Codex unavailable | Independent 2nd opinion | 1 | unavailable (Codex); native completed | 10 findings, 1 new decision (D10), rest corrected or noted |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 10 issues, 0 critical gaps (9 decisions D1-D9 plus D10 from the outside voice, all answered) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 4/10 → 8/10, 9 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** eng phase: provider codex, unavailable (model not configured for the custom endpoint); native Claude fallback completed. Design phase: unavailable (Codex model unset; independent Claude agent failed on a network error). A native result does not count as outside coverage.
- **CROSS-MODEL:** the native review and the outside voice overlapped on the token/log exposure only in part: the primary review missed it, the outside voice found it (D10). The reviewer's "smaller v1" advice conflicts with the owner's decision D1 B and stays as a recorded disagreement.
- **VERDICT:** ENG + DESIGN reviewed (primary plus native fallback). Eng status issues_open means mapped work (every finding has an accepted disposition), not a blocker.

NO UNRESOLVED DECISIONS
