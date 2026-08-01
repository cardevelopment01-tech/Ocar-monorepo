# Add Cities: Angul, Jajpur, Paradip

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Onboard three client-requested Odisha towns — Angul, Jajpur, and (assumed) Paradip — as serviceable cities, following the exact pattern already used for Bhubaneswar/Cuttack/Puri.

**Assumption to confirm with client:** "Pradeep" is almost certainly **Paradip** (the port town in Jagatsinghpur district, ~120 km from Bhubaneswar, home to Paradip Port and IOCL refinery) — there is no town named "Pradeep" in Odisha. Everything below proceeds on that assumption; flag it back to the client before going live.

---

## Research: city data

| City | District | Centroid (lat, lng) | Distance from Bhubaneswar hub | Notes |
|---|---|---|---|---|
| Angul | Angul | 20.8400, 85.1425 | ~130 km | Coal/power industrial town (NALCO, MCL, NTPC) |
| Jajpur | Jajpur | 20.8500, 86.3333 | ~100 km | Kalinga Nagar industrial belt (steel plants) |
| Paradip | Jagatsinghpur | 20.3167, 86.6167 | ~120 km | Port town, IOCL refinery, heavy freight/worker traffic |

These are **town-centre point coordinates**, accurate enough for the `centroid` column (used only for "nearest city" lookup and map pins) — not survey-grade. Whoever runs the migration should eyeball each point against Google Maps before it ships, same as the original three.

**"Polylines that cover it" — how this codebase actually models that:**
- There is no per-city "polyline" concept in this platform. What exists is `cities.boundary` — a flat rectangular bounding box (`geometry(Polygon,4326)`), used only for two things: (a) `classifyTrip()`'s in-city-vs-outstation check, and (b) the (currently commented-out, Phase 2) per-zone speed limit table. See `017_city_boundaries.sql` and `055_merge_khorda_bbsr_ctc_boundary.sql` — even Bhubaneswar/Cuttack use a hand-drawn rectangle, not a real polygon traced to the city outline.
- `return_cab_routes.corridor` (a `LineString`) *is* a real polyline, but it's generated **per driver session at runtime** from that driver's actual GPS trip — never seeded per city. Adding a city requires nothing here.
- **Conclusion:** these three towns don't need boundary polygons at all unless the client wants in-city rentals there. They're being added as **one-way/round-trip outstation destinations** (matching how Puri currently works — seeded, no rental yet), so centroid-only is correct and matches best practice already established in this codebase (don't build the rental fence until the feature is needed there).

---

## Key finding: no code change is required

The admin Cities page (`apps/admin/app/(dashboard)/cities/page.tsx`) already has a full "Add City" form wired to `POST` → `createCity()` (`api/src/modules/geo/geo.repository.ts:164`) — name, slug, state, centroid lat/lng, speed limit, status, rental/return-cab toggles. This is exactly the ladder's rung 2: reuse what's already built. The three cities can be added **today, through the existing admin UI**, by whoever has admin access — no deploy needed.

The only reason to also land a migration (`016_seed.sql`-style insert) is to keep the seed data reproducible for fresh DB setups (local dev, staging, disaster recovery) — same reason Bhubaneswar/Cuttack/Puri live in `016_seed.sql` instead of only existing in prod's live table. Recommended: do both — insert via UI now (client sees it immediately) *and* land the migration so `pnpm migrate --fresh` reproduces it.

---

## Task 1: Seed the three cities (migration)

**Files:**
- Create: `api/src/db/migrations/069_add_angul_jajpur_paradip.sql` (next number after `068_admin_audit_log_reason.sql`, confirmed as the current max)

- [ ] **Step 1: Write the insert migration**

```sql
-- Client-requested cities: outstation destinations only (no rental boundary yet,
-- matching how Puri shipped — see 016_seed.sql). Status 'active' so they're
-- immediately bookable as one-way/round-trip destinations; rental/return-cab
-- stay off until the client asks to enable local service in these towns.

INSERT INTO cities (
  name, slug, state,
  centroid,
  default_speed_limit_kmph,
  status,
  is_rental_enabled,
  is_return_cab_enabled
) VALUES
  (
    'Angul', 'angul', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(85.1425 20.8400)'),
    45, 'active', false, false
  ),
  (
    'Jajpur', 'jajpur', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(86.3333 20.8500)'),
    45, 'active', false, false
  ),
  (
    'Paradip', 'paradip', 'Odisha',
    ST_GeogFromText('SRID=4326;POINT(86.6167 20.3167)'),
    45, 'active', false, false
  )
ON CONFLICT (slug) DO NOTHING;
```

Note `ST_GeogFromText('POINT(lng lat)')` — longitude first, matching the existing seed's convention and the project-wide PostGIS invariant in `CLAUDE.md`.

- [ ] **Step 2: Run it locally and verify**

```powershell
cd api && pnpm migrate
```

Then confirm via psql:
```sql
SELECT name, slug, ST_AsText(centroid::geometry) FROM cities WHERE slug IN ('angul','jajpur','paradip');
```

- [ ] **Step 3 (self-check):** confirm `findNearestCity()` resolves correctly for a point near each new town (e.g. lat/lng close to Angul's centroid should return Angul, not Bhubaneswar). One quick manual call through `/api/v1/geo/cities/nearest` or a scratch query is enough — this is a lookup ORDER BY distance, not new logic, so no new test file is warranted.

---

## Task 2 (optional polish): admin Live Map city-jump list

**Files:**
- Modify: `apps/admin/components/LiveMap.tsx:18-20`

- [ ] Add the three towns to the hardcoded jump-list so ops can recenter the live map on them:
```ts
{ label: 'Angul',   lat: 20.8400, lng: 85.1425, zoom: 12 },
{ label: 'Jajpur',  lat: 20.8500, lng: 86.3333, zoom: 12 },
{ label: 'Paradip', lat: 20.3167, lng: 86.6167, zoom: 12 },
```
This is cosmetic (map recenter shortcuts) — skip if the client didn't ask for ops tooling, add later if an ops person wants it.

---

## Explicitly out of scope (skipped, not forgotten)

- **Rental boundary polygons** — not needed until the client wants in-city hourly rentals in these towns. Adding one later is a one-row `UPDATE cities SET boundary = ST_GeomFromText(...)` matching `017_city_boundaries.sql`.
- **Per-city pricing** — `rate_cards` are category/ride-type based, not per-city (see `api/src/lib/fare.ts`); the existing 5-category rate cards apply automatically to trips to/from these towns. No pricing changes needed unless the client wants different rates for these routes specifically.
- **User app "popular routes" / driver `india-geo.ts` picker** — already-known hardcoded constants (see `CLAUDE.md` caveats); Angul/Jajpur/Paradip can be added there the same way if the client wants them surfaced as quick-pick destinations, but that's a UI-copy decision for the client, not a functional requirement.
