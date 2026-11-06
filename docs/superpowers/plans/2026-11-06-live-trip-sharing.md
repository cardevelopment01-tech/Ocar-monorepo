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
| D4 | Token: 128-bit random, **only SHA-256 stored** (same rule as refresh tokens) | A DB leak yields no usable links |
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

Expiry is **computed**, not stored: expired when `now() > terminalAt(ride) + 30 min` or `now() > created_at + 7 days`. A cleanup job deletes shares 30 days after the ride ends (no recipient phone numbers kept). Account deletion cascades.

## 6. API

**Authenticated (rider):**
- `POST /api/v1/rides/:id/shares` `{ contactIds?: string[] }` → creates 1 anonymous share (no contacts) or 1 per contact and sends the SMS; returns `[{id, url, label}]`. Rules: the ride is the caller's; status ∈ accepted / driver_arrived / in_progress / returning; ≤10 active shares per ride; 20 creations/hour/user.
- `GET /api/v1/rides/:id/shares` → active shares with `viewCount`, `lastViewedAt`.
- `DELETE /api/v1/rides/:id/shares/:shareId` and `DELETE /api/v1/rides/:id/shares` (stop all).

**Public (no auth):** `GET /api/v1/public/trips/:token`
- Hash → lookup. Unknown/revoked → **404** (same body); known but expired → **410**. Rate limit **60/min/IP** and **120/min/token**.
- Returns the D7 DTO plus `phase` (`driver_on_way | in_trip | completed | cancelled`), `driver {lat,lng,heading,updatedAt}`, `etaMin`, `route` (planned polyline), `serverTime`.
- `Cache-Control: no-store`. The server caches the DTO **2 s per ride** in Redis so N viewers cost one DB read; ETA comes from a **per-ride route call cached 60 s** (≈ one Routes call per minute of an actively viewed shared trip, ≈ ₹0.4).
- Updates `view_count` / `last_viewed_at` at most once per minute per share.

**Config:** `system_config.trip_share_enabled` kill switch (default off until DLT + QA are done).

## 7. SOS integration

The `sos_contact` SMS carries a **live link** (auto-created share, label "SOS", `is_sos = true`) instead of a static pin, and falls back to the static pin if share creation fails. Needs the template re-registered on DLT (wording change).

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
| Duplicate taps on Share | Idempotent per (ride, user) for anonymous links within 10 min |
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
3. **Public endpoint + DTO builder + cache + limiter:** tests for phases, 404/410, stale flag, and a deny-list test that the DTO never contains phone / fare / OTP fields.
4. **Cleanup job** (purge) + account-deletion cascade test.
5. **SOS link upgrade** (template + fallback test).
6. **apps/user `/t/[token]` page:** all §4 states, i18n (en/hi/or), noindex/referrer headers, polling hook with back-off; component tests per state.
7. **rider-mobile:** `Share trip` action, share sheet, banner / manage list; tests for the model (which actions show when) and the sheet states.
8. **QA on staging:** two phones + a desktop browser: share while en route, while in trip, revoke, end trip, expiry, offline driver; check the WhatsApp preview.
9. **Rollout:** DLT template registration (`trip_share`, updated `sos_contact`), flag on for internal testers, then everyone.

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

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | design outside voices (Codex + independent Claude agent) | Independent 2nd opinion | 1 | unavailable | Codex has no model set for the custom endpoint; the Claude agent failed on a network error |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | — |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | clean | score: 4/10 → 8/10, 9 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** design phase: provider codex, unavailable (model not configured); native fallback agent also failed (network). No outside coverage.
- **VERDICT:** DESIGN CLEARED (primary review only). Eng review required.

NO UNRESOLVED DECISIONS
