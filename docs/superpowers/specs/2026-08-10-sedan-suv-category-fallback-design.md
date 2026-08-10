# Sedan/SUV Category Fallback — Correction + Rider/Driver UX

**Date:** 2026-08-10
**Status:** Draft, pending user review

## 1. Background

The client asked for cars to serve overflow bookings one tier below their own category
when the exact category is scarce nearby — improving driver utilization and cutting
rider wait times, without ever changing what the rider pays.

Investigation found this mechanism **already exists** in the codebase:
`category_fallback_rules` (migration `081_category_fallback_rules.sql`),
`broadcast.processor.ts` (round 1 = exact match only, rounds 2+ widen via the fallback
table), and `fare_snapshots` (fare is locked to the rider's *requested* category at
booking time, before any driver is matched — a fallback-tier driver never changes the
price). This is not a new feature; it is a **correction to existing fallback data** plus
a **rider/driver communication gap-fill**.

## 2. Confirmed client spec

- Hatchback booking, no Hatchback nearby → **Sedan** absorbs it.
- Sedan booking, no Sedan nearby → **SUV** absorbs it.
- Fallback only ever goes **up** one tier — never down. A Sedan booking can never be
  filled by a Hatchback; an SUV booking can never be filled by a Sedan.
- **Hatchback, Luxury, and Van stay strictly in their own category** — no fallback in or
  out, in either direction, for any of the three.
- Rider always pays the price of the category they booked, regardless of which car
  shows up.
- The fallback applies automatically to every Sedan/SUV driver — no per-driver opt-in
  toggle (confirmed with the user; matches what's already live).

## 3. Bug found: current data violates the Luxury rule

| Rule | Client spec | Current `category_fallback_rules` row | Verdict |
|---|---|---|---|
| Hatchback → Sedan | Sedan absorbs | `sedan accepts hatchback` | Correct |
| Sedan → SUV | SUV absorbs | `suv accepts sedan` | Correct |
| SUV → Luxury | **Must not exist** | `luxury accepts suv` | **Bug — delete this row** |

The table was originally modeled as a uniform ladder (hatchback→sedan→suv→luxury), but
the client's spec makes Luxury a hard boundary, not a ladder continuation. Because the
fallback graph is already data-driven (`getEligibleDriverCategoryIds` reads the table
generically), the fix is a data correction, not a code change.

## 4. Design

### 4.1 Data fix

New migration `084_remove_luxury_suv_fallback.sql`:

```sql
DELETE FROM category_fallback_rules
WHERE category_id = (SELECT id FROM vehicle_categories WHERE slug = 'luxury')
  AND accepts_category_id = (SELECT id FROM vehicle_categories WHERE slug = 'suv');
```

After this, the table holds exactly two rows: `sedan←hatchback`, `suv←sedan`. No
application code changes — the matching logic was already generic over this table.

### 4.2 Backend: expose category names on a ride

`getRideById` (`api/src/modules/rides/rides.repository.ts:533-579`) currently resolves
the assigned vehicle's make/model/plate but never resolves *category* for either the
booked ride or the assigned vehicle. Add two joins to `vehicle_categories`:

- `rides.category_id` → `booked_category_name`
- `driver_vehicles.category_id` → `assigned_category_name`

Both are needed so the frontend can compare them without a second round-trip. This is
the one real backend gap; everything else downstream (fare, matching) already works.

### 4.3 Rider UX — research and rationale

**Research basis:** industry pattern for forced vehicle substitution at unchanged price
(Uber/Ola-style "free upgrade") separates two moments, per standard toast-vs-banner
guidance (toasts = one-time event-driven feedback, auto-dismissing; banners/inline
messages = an ongoing condition the user may want to re-check) — Mobbin's banner
pattern library documents the same split (promotional/acknowledgement banners are
transient; status banners embedded in a content card are persistent for the life of
that state). Applying that split here:

**Moment 1 — driver assigned (transient, celebratory).**
A toast appears once, right when the driver-assigned screen loads, then auto-dismisses
after ~4s. Non-blocking — it must not delay the rider from seeing the map/ETA.

- Copy: *"You've been upgraded to a {Assigned} — same fare, more room."*
- Never say "downgrade," "substitute," or "no {Booked} available" — the client's
  no-downward-fallback rule means "upgrade" is always literally true, so the positive
  framing isn't spin.
- Visual: reuse existing tokens, no new colors. `money` (`#059669` / `money-light`
  `#D1FAE5`) reads as "you save/gain," which fits an upgrade-at-no-cost message better
  than `status.success` (already used for generic confirmations elsewhere) or
  `status.info`. Slide up with the existing `animate-slide-up` keyframe already in
  `tailwind.config.ts` — no new animation needed.
- Only rendered when `assigned_category_name !== booked_category_name`. Exact-match
  rides (the common case) show nothing new.

**Moment 2 — persistent, for the rest of the ride.**
A small pill badge (`bg-money-light text-money`, `rounded-full`) reading **"Upgraded"**
sits inline next to the vehicle category label on the existing vehicle-info card on the
tracking screen (`apps/user/app/(main)/ride/[id]/page.tsx`) — an inline-banner-in-card
placement, not a full-width banner, so it doesn't compete with map/ETA/driver-contact
controls for attention. Tapping the badge opens a small tooltip/bottom-sheet with the
same one-line explanation as the toast, for a rider who dismissed the toast and later
wonders why the car looks different from what they booked.

**Moment 3 — push notification.**
The existing "driver assigned" notification template (`notification_templates`, sent via
`notifyOwner()`) gets one conditional line appended when categories differ: *"Upgraded to
{Assigned} at no extra cost."* Same copy, same channel already firing — no new
notification event type.

### 4.4 Driver UX

Static help text under the category grid in
`apps/driver/src/pages/Onboarding/VehicleRegistration.tsx:226-235` and the mirrored
`Settings/VehicleDetails.tsx`, shown only when Sedan or SUV is selected:

- Sedan selected: *"Sedan drivers also receive Hatchback requests when Hatchbacks are
  scarce nearby, paid at Sedan fare."*
- SUV selected: *"SUV drivers also receive Sedan requests when Sedans are scarce nearby,
  paid at SUV fare."*
- Hatchback/Luxury/Van selections show no note (they're not part of the fallback chain).

Read-only copy, no new toggle or state — mandatory-for-all was confirmed earlier in this
design process.

## 5. Explicitly out of scope (YAGNI)

- No new tables, no new API endpoints.
- No changes to `broadcast.processor.ts` round logic or `fare.ts` — both already
  correct.
- No per-driver opt-out toggle.
- No downward fallback (Sedan booking → Hatchback car) — ruled out by the client, and
  structurally impossible today since fallback rows only add an absorbing tier, never a
  downgrade target.
- No new notification event type — reusing the existing driver-assigned template with
  one conditional line.

## 6. Testing

- **Migration:** after `084` runs, `category_fallback_rules` has exactly two rows
  (`sedan←hatchback`, `suv←sedan`); a fresh `--fresh` migrate still seeds correctly with
  no Luxury row.
- **Repository:** a test on `getRideById` asserting `booked_category_name` and
  `assigned_category_name` are both present and correctly resolved, for both an
  exact-matched ride and a fallback-matched ride.
- **Manual:** book a Sedan ride with no Sedan driver online → confirm only an SUV driver
  (not Hatchback) receives the broadcast in round 2+, the rider sees the upgrade toast
  and badge, the push notification includes the upgrade line, and the fare charged is
  still the Sedan rate. Repeat for Hatchback→Sedan. Confirm an SUV-scarce Luxury booking
  does **not** get filled by a Luxury driver's fallback (there is none) and instead just
  waits/expires per normal no-match handling.
