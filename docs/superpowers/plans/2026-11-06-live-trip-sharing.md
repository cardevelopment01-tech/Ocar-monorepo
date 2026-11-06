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
   - Footer: "Anyone with the link can see this trip until it ends. You can stop sharing anytime."
3. **While sharing:** a slim banner above the sheet: *"Sharing live · 2 links · Stop"*. Tap → manage list (label, "viewed 3×", Stop each, Stop all).
4. **Stop:** confirm only for *Stop all*; toast "Sharing stopped — links no longer work".
5. **States:** no driver yet (button disabled with hint "Available once a driver is assigned"); offline (show error + retry, no silent queue); ride ended (banner disappears; shares expire by D6).

### Public tracking page (`/t/<token>`, mobile-first)
- Full-bleed map; **status pill** at the top: *On the way to pickup · 4 min* / *In trip · Arriving 4:35 pm* / *Trip completed* / *Trip cancelled*.
- Bottom card: *"Rahul is on a trip"*, driver first name, **vehicle + plate (large)**, From → To.
- Footer: "Shared via Ocar · updates every 5 seconds".
- **States:** loading skeleton; live; **stale** (driver position >60 s old → dot greys, "Last seen 2 min ago"); network-error banner with auto-retry; completed; cancelled; expired/revoked ("This link is no longer active"); invalid.
- Safe by default: `noindex`, `Referrer-Policy: no-referrer`, generic OG preview ("Live trip on Ocar", no names), no analytics keyed on the token.
- Language: English + Hindi + Odia, strings externalised (Odisha audience).
- Accessibility: status as text not colour, ≥44 px targets, the map is not the only carrier of information.

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
  view_count      INT NOT NULL DEFAULT 0
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

The `sos_contact` SMS carries a **live link** (auto-created share, label "SOS") instead of a static pin, and falls back to the static pin if share creation fails. Needs the template re-registered on DLT (wording change).

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

1. Which map library does the `apps/user` tracking page use (cost of a public page at scale; OSM tiles have usage limits)?
2. Should the public page show the **drop address** or only a coarse area? (Safety value vs. exposing a home address to anyone with the link.)
3. Is a 30-min post-trip grace right, or should the page flip to "completed" and go dead immediately?
4. Are the rate limits and the 5 s polling interval acceptable for the expected volume?
5. Should v1 include "contact viewed your trip" (cheap, reassuring) or hold it for v2?
