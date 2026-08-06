# Vehicle Category Fallback Matching — Design

## Problem

Ride broadcast and `return-cab-available` match riders to drivers by exact
`category_id` equality (`rides.repository.ts` `findNearbyDrivers`,
`findReturnCabDrivers`). If no driver of the rider's exact category is
online nearby, the ride goes unmatched even if a higher-tier driver (who is
happy to serve a lower tier) is available. Client request: let a driver's
vehicle serve its own category plus one tier below it, to raise effective
driver supply per ride request.

## Ladder

```
Hatchback ← Sedan ← SUV ← Luxury
```
Each arrow reads "driver of this category also accepts requests from the
category behind the arrow." `van` is excluded — it doesn't sit on this
price ladder (cheaper than luxury/suv per `016_seed.sql` rate cards) and the
client didn't mention it.

## Non-goals

- No change to rider-facing category selection or pricing.
- No admin UI for editing fallback rules (data model supports it later;
  not building the CRUD page now — no ask for it).
- No change to `acceptAssignment` accept-time validation.

## Data model

New migration, `category_fallback_rules`:

```sql
CREATE TABLE category_fallback_rules (
  category_id BIGINT NOT NULL REFERENCES vehicle_categories(id),
  accepts_category_id BIGINT NOT NULL REFERENCES vehicle_categories(id),
  PRIMARY KEY (category_id, accepts_category_id)
);

-- seed: sedan drivers also accept hatchback rides; suv also accepts sedan;
-- luxury also accepts suv
INSERT INTO category_fallback_rules (category_id, accepts_category_id)
SELECT s.id, h.id FROM vehicle_categories s, vehicle_categories h
WHERE s.slug = 'sedan' AND h.slug = 'hatchback';
INSERT INTO category_fallback_rules (category_id, accepts_category_id)
SELECT s.id, sd.id FROM vehicle_categories s, vehicle_categories sd
WHERE s.slug = 'suv' AND sd.slug = 'sedan';
INSERT INTO category_fallback_rules (category_id, accepts_category_id)
SELECT l.id, s.id FROM vehicle_categories l, vehicle_categories s
WHERE l.slug = 'luxury' AND s.slug = 'suv';
```

`category_id` = the driver's own vehicle category. `accepts_category_id` =
an additional rider-booked category that driver category is eligible for.
A driver's own category is always implicitly eligible (existing exact
match) — this table only stores the *extra* accepted category, keeping the
"always eligible for own tier" invariant enforced in code, not data.

## Matching logic

New repository helper in `rides.repository.ts`:

```ts
async function getEligibleDriverCategoryIds(rideCategoryId: bigint): Promise<bigint[]> {
  const { rows } = await pool.query(
    `SELECT category_id FROM category_fallback_rules WHERE accepts_category_id = $1`,
    [rideCategoryId]
  )
  return [rideCategoryId, ...rows.map(r => BigInt(r.category_id))]
}
```

(Reads "which driver categories accept this rider category" — inverse of
the table's own-category-first framing, which is what the matching query
needs.)

`findNearbyDrivers` and `findReturnCabDrivers` change their category filter
from `ds.category_id = $N` to `ds.category_id = ANY($N::bigint[])`, taking
an array of eligible category ids instead of a single id.

## Staged rollout via existing broadcast rounds

`broadcast.processor.ts` already runs 3 pre-scheduled rounds (0s/5km,
25s/10km, 50s/20km — `rides.service.ts` L574-592). No new scheduling
infrastructure is needed:

- **Round 1**: eligible set = `[ride.categoryId]` only (exact match) —
  native-tier drivers get first crack at their own-tier fare.
- **Round 2 & 3**: eligible set = `getEligibleDriverCategoryIds(ride.categoryId)`
  — widens to include the fallback tier once the ride has gone unaccepted
  past round 1.

This is a conditional on the existing `broadcastRound` value already passed
into the processor — no new queue, job type, or delay.

## `return-cab-available`

No rounds concept here — it's a single live "what can I get now" query
(`rides.routes.ts` `GET /return-cab-available`). It calls
`getEligibleDriverCategoryIds` unconditionally (no round gating) since
there's no staging to apply.

## Fare — unchanged

The ride's `category_id` (set at booking, immutable) still drives fare via
`getFareEstimate`/`getCurrentRateCard`. The rider pays their booked-category
rate regardless of which tier driver accepts. No changes to `fare.ts`,
`pricing.repository.ts`, or rate cards.

## Accept-time — unchanged

`acceptAssignment` (`rides.repository.ts`) only guards on ride status
(`WHERE id=$1 AND status='requested'`). No category re-check needed: the
`ride_assignments` row backing the accept only exists for drivers who were
already eligible when the broadcast round ran.

## Driver app

The ride-request card must render the rider's *booked* category (e.g.
"Sedan ride") rather than assume it equals the driver's own vehicle
category — relevant now that an SUV driver can receive a Sedan-labeled
request. Verify the existing request-card component already reads category
from the ride payload (it should, since it already needs to display fare
for the booked category) rather than a driver-side assumption; fix if it
doesn't.

## Testing

- Unit test `getEligibleDriverCategoryIds`: sedan → `[sedan, hatchback]`;
  luxury → `[luxury, suv]`; hatchback → `[hatchback]` (no fallback rows
  targeting it); van → `[van]` (unaffected, no ladder membership).
- Broadcast processor test: round 1 query receives exact-category array
  only; round 2/3 receives the widened array.
- `findNearbyDrivers`/`findReturnCabDrivers`: array-based `= ANY(...)`
  filter returns both native and fallback-tier driver sessions.
