# Return Cab City-Wide Drop-off Matching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A return-cab driver heading to city X should match ANY rider whose drop-off is in city X (whole city), not just riders dropping within 2km of the city's centroid point. Pickup stays a tight "on my way" check, widened 2km→3km.

**Root cause (already debugged with client):** `findReturnCabDrivers` requires the drop-off be within `match_radius_metres` (2km) of the destination-city *centroid*. A real Puri address 2.2km from the centroid dot silently fails to match. Treating a city as a 2km circle around one point is the design flaw.

**Architecture:** Store the driver's chosen `destination_city_id` on `return_cab_routes` (the session already stores it — the route row discards it). Replace the drop-off's centroid-radius check with a **nearest-active-city classification** (the pattern already used everywhere in this codebase for "what city is this point in"): a drop-off is "in the destination city" iff that city's centroid is the closest active city centroid to the drop point. Pickup check switches from the corridor line to the driver's origin point at a 3km radius.

**Tech Stack:** Express + TypeScript, PostgreSQL (`pg` pool) + PostGIS, Vitest. No fare/pricing changes, no new endpoints, no admin UI.

---

## Task 1: Migration — add `destination_city_id`, bump pickup radius default

**Files:**
- Create: `api/src/db/migrations/082_return_cab_city_match.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 082_return_cab_city_match.sql
-- Return-cab matching now uses the driver's DESTINATION CITY IDENTITY for the
-- drop-off check (any drop-off whose nearest active city is this city matches),
-- instead of a fixed radius around the city centroid point. A real address a
-- few km from a city's centroid dot is still "in that city" and must match.
--
-- destination_city_id: the city the driver chose at go-online. Nullable: only
-- new go-online rows populate it. Existing active rows (drivers currently online
-- in return mode) stay NULL and simply stop matching until their next go-online
-- — return-cab sessions are ephemeral (re-created every time a driver goes
-- online), so no backfill is warranted.
ALTER TABLE return_cab_routes
  ADD COLUMN destination_city_id BIGINT NULL REFERENCES cities(id);

-- match_radius_metres is now PICKUP-ONLY ("is the rider near where I'm starting
-- my return trip"). Client-confirmed value is 3km. Drop-off no longer uses it.
ALTER TABLE return_cab_routes
  ALTER COLUMN match_radius_metres SET DEFAULT 3000;

UPDATE return_cab_routes
  SET match_radius_metres = 3000
  WHERE match_radius_metres = 2000 AND is_active = true;
```

- [ ] **Step 2: Run** — `cd api && pnpm migrate`. Expected: `082_return_cab_city_match.sql` applied, no errors.

- [ ] **Step 3: Verify** — `docker exec ocar_postgres psql -U postgres -d ocar -c "\d return_cab_routes"`. Expected: `destination_city_id` column present with FK to cities; `match_radius_metres` default `3000`.

- [ ] **Step 4: Commit** — `git add api/src/db/migrations/082_return_cab_city_match.sql && git commit -m "feat(rides): add destination_city_id to return_cab_routes, pickup radius 3km"`

---

## Task 2: `goOnline` stores `destination_city_id` on the route row

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts` (INSERT at ~L190-203)
- Test: `api/tests/unit/rides/return-cab-goonline.test.ts` (new)

- [ ] **Step 1: Write the failing test.** New file mirroring `go-online-low-balance.test.ts`'s mock setup, but `mode: 'return_cab'`, `destinationCityId: BigInt(3)`. Mock `pool.query` to return `{ rows: [{ billing_mode: 'commission' }] }` for the billing lookup and `{ rows: [{ dest_lat: 19.81, dest_lng: 85.83 }] }` for the centroid lookup. Assert one `pool.query` call's SQL `toContain('INSERT INTO return_cab_routes')` AND `toContain('destination_city_id')`, and that its params array contains `BigInt(3)`.

- [ ] **Step 2: Run — expect FAIL** (column/value not in INSERT). `cd api && npx vitest run tests/unit/rides/return-cab-goonline.test.ts`

- [ ] **Step 3: Implement.** In the INSERT (rides.service.ts ~L190-203) add the column and value:

```ts
await pool.query(
  `INSERT INTO return_cab_routes
     (session_id, driver_id, destination_city_id,
      origin_lat, origin_lng,
      destination_lat, destination_lng,
      corridor)
   VALUES ($1,$2,$3,$4::float8,$5::float8,$6::float8,$7::float8,
     ST_MakeLine(
       ST_SetSRID(ST_MakePoint($5::float8, $4::float8), 4326),
       ST_SetSRID(ST_MakePoint($7::float8, $6::float8), 4326)
     )::geography
   )`,
  [session.id, driverId, data.destinationCityId, data.lat, data.lng, cityRow.dest_lat, cityRow.dest_lng]
)
```

(`data.destinationCityId` is guaranteed non-null here — the enclosing `if (data.mode === 'return_cab' && data.destinationCityId)` already gates it. `corridor` and `destination_lat/lng` are kept as-is for the minimal diff; corridor is now unused by matching but harmless.)

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(rides): persist destination_city_id when driver goes online in return mode"`

---

## Task 3: `findReturnCabDrivers` — city-identity drop check + 3km pickup

**Files:**
- Modify: `api/src/modules/rides/rides.repository.ts` (L185-245)
- Test: `api/tests/unit/rides/find-nearby-drivers-wallet-gate.test.ts`

- [ ] **Step 1: Write the failing test.** Add a case to the existing suite:

```ts
it('findReturnCabDrivers matches drop-off by nearest-city identity, pickup within 3km', async () => {
  await findReturnCabDrivers({
    pickupLat: 20.255981, pickupLng: 85.866363,
    dropLat: 19.8014, dropLng: 85.8142,
    categoryId: BigInt(2), minWalletBalance: 500,
  })
  const [sql] = poolQuery.mock.calls[0] as [string, unknown[]]
  // drop-off is classified to nearest city, compared to the route's destination city
  expect(sql).toContain('rcr.destination_city_id')
  // pickup check is against the driver's origin point at the route radius (now 3km)
  expect(sql).toContain('rcr.match_radius_metres')
  // the old double-corridor drop-radius clause is gone
  expect(sql).not.toMatch(/ST_DWithin\(\s*rcr\.corridor[\s\S]*ST_DWithin\(\s*rcr\.corridor/)
})
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Replace the two `ST_DWithin(rcr.corridor, ...)` clauses (L230-239) and add a drop-city LATERAL. Keep param order `$1..$6` identical so the existing `$6` wallet assertions still hold:

```ts
     LEFT JOIN LATERAL (
       SELECT c.billing_mode
       FROM cities c
       WHERE c.status = 'active'
       ORDER BY ST_Distance(c.centroid, dls.location) ASC
       LIMIT 1
     ) nc ON true
     -- nearest active city to the DROP-OFF point (its own lateral — nc above is
     -- nearest-city-to-driver for billing_mode, a different point). Standard
     -- nearest-centroid city classification, same pattern used at go-online and
     -- in findNearbyDrivers.
     LEFT JOIN LATERAL (
       SELECT c.id AS city_id
       FROM cities c
       WHERE c.status = 'active'
       ORDER BY ST_Distance(
         c.centroid,
         ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography
       ) ASC
       LIMIT 1
     ) drop_city ON true
     WHERE rcr.is_active = true
       AND ds.status = 'online'
       AND ds.category_id = $5
       AND ( /* wallet/billing block unchanged — still references $6 */ )
       -- Pickup: within match_radius_metres (3km) of the driver's return-trip
       -- START point, not the corridor line — a pickup near the destination end
       -- must NOT pass the pickup check. ponytail: no index on origin point;
       -- return_cab_routes is tiny (online return drivers only, partial-indexed
       -- by is_active) so a seq scan is fine — add a functional GiST index only
       -- if this table ever grows.
       AND ST_DWithin(
         ST_SetSRID(ST_MakePoint(rcr.origin_lng::float8, rcr.origin_lat::float8), 4326)::geography,
         ST_SetSRID(ST_MakePoint($2::float8, $1::float8), 4326)::geography,
         rcr.match_radius_metres
       )
       -- Drop-off: anywhere in the destination city — its nearest active city
       -- centroid must be the route's chosen destination city.
       AND drop_city.city_id = rcr.destination_city_id
     ORDER BY distance_metres ASC
     LIMIT 3
```

Params array stays `[pickupLat, pickupLng, dropLat, dropLng, categoryId, minWalletBalance]`.

- [ ] **Step 4: Run — expect PASS** (new case + both pre-existing wallet-gate cases still green).

- [ ] **Step 5: Commit** — `git commit -am "fix(rides): match return-cab drop-off by destination-city identity, 3km pickup"`

---

## Task 4: Full suite + typecheck + live verification

**Files:** none (verification only)

- [ ] **Step 1:** `cd api && pnpm test` — all green, incl. Tasks 2-3 tests.
- [ ] **Step 2:** `cd api && npx tsc --noEmit` — no errors. Confirms `broadcast.processor.ts` and `rides.routes.ts` callers of `findReturnCabDrivers` still typecheck (their signature is unchanged — they pass drop lat/lng, which is what now feeds the classification).
- [ ] **Step 3 (repro the live case):** with the app running, seed a return-cab driver online at `(20.255981, 85.866363)` heading to Puri, then:
  `curl "http://localhost:3000/api/v1/rides/return-cab-available?pickupLat=20.255981&pickupLng=85.866363&dropLat=19.8014&dropLng=85.8142&categoryId=<puri-sedan-cat-id>"`
  Expected: `count >= 1` (the exact production case that previously returned 0 because the drop was 2.2km from Puri's centroid).
- [ ] **Step 4: Commit** any fixes surfaced.

---

## Notes / deliberate scope cuts

- **`match_radius_metres` kept, not renamed/dropped.** Rename = extra column churn + code edits for zero behavior gain; it stays as a per-route pickup knob (repurposed, documented).
- **`corridor` + `destination_lat/lng` columns left in place**, now unused by matching. Dropping them is churn/risk with no payoff; leave them.
- **`destination_city_id` nullable, no backfill** — return-cab route rows are ephemeral (recreated on every go-online). Existing NULL rows simply stop matching until the driver next goes online. Documented in the migration.
- **Migration-number collision:** used `082` because the unrelated `2026-08-06-vehicle-category-fallback.md` draft claims `081`. That draft also changes `findReturnCabDrivers`'s `categoryId`→`categoryIds` ($5) — orthogonal WHERE clause, but whoever lands second rebases the `$5` param. Not merged here.
- No fare/pricing, no new endpoints, no admin radius-tuning UI.

### Critical Files for Implementation
- `api/src/db/migrations/082_return_cab_city_match.sql` (new)
- `api/src/modules/rides/rides.repository.ts`
- `api/src/modules/rides/rides.service.ts`
- `api/tests/unit/rides/find-nearby-drivers-wallet-gate.test.ts`
- `api/src/db/migrations/007_m5_booking.sql` (reference — table definition being altered)
