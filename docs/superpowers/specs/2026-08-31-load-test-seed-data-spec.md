# Load-Test Seed-Data Spec — 1M Historical Rides

**Date:** 2026-08-31
**Status:** Draft for human review. Spec only — no seed script/SQL written or run.
**Driver:** Provides the data-generation contract for `docs/LOAD_TEST_PLAN.md` §3
("~1,000,000 historical ride records ... with associated status history, fare
calculations, and payment records, dated across the past 12 months" +
synthetic riders + reused real drivers).

**Method:** Every column/constraint/enum below was read from the actual
`api/src/db/migrations/*.sql` files and the four critical-query handlers in
`api/src/modules/**`. SQL was read directly (graphify does not model SQL — same
note made in `2026-07-26-db-loadtest-readiness-design.md:8`). Citations are
`file:LINE`.

---

## 1. Scope

Per `LOAD_TEST_PLAN.md` §3, this seed produces exactly enough historical volume
to make the two query-performance-at-volume tests meaningful — **admin rides
list** and **driver ride history** — plus the write path for **ride creation**,
without distorting the query plans the app actually runs. **In scope:** synthetic
rider `users`, `rides` (1M, spread over 12 months, business-realistic status/type
/geo/date distribution), `ride_status_history`, `fare_snapshots`, `payments`, and
the conditional children the four query paths join or the correctness check reads
(`ride_cancellations`, `ratings`). Real, already-onboarded `drivers` (+ their
`driver_vehicles`) are **reused, never fabricated or altered**
(`LOAD_TEST_PLAN.md:53-55,63-64`); `cities`, `vehicle_categories`, `rate_cards`,
`stop_charges`, `rental_packages` are **reused from `016_seed.sql`** — no new
reference rows invented (`LOAD_TEST_PLAN.md` §3 "reuse real data where it exists").

**Explicitly OUT of scope** (finding, not omission):

- **`gps_tracks` — NOT bulk-seeded.** The live-driver-matching query
  (`rides.repository.ts:150-195`, `findNearbyDrivers`) reads only
  `driver_location_snapshots` (one row/driver), `driver_sessions`,
  `driver_wallets`/`driver_package_wallets`, `drivers`→`cities`. It never touches
  `gps_tracks`, and `gps_tracks` has **no FK to `rides`** by design
  (`005_m3_geo.sql:92-95`), so historical GPS density does not affect any of the
  four critical queries. GPS breadcrumbs are produced live by the traffic ramp,
  not by this seed.
- **`driver_sessions` / `driver_location_snapshots` / `return_cab_routes` —
  NOT bulk-seeded.** These are the *live* fleet state the traffic ramp creates
  when real drivers go online. Live-matching performance scales with the live
  fleet (~400 drivers, `LOAD_TEST_PLAN.md` §4), not with the 1M ride seed —
  seeding 1M historical rides adds zero rows to the snapshot table. Historical
  `rides.session_id` is left NULL (nullable, `007_m5_booking.sql:137`).
- **`ride_assignments`, `ride_otp_events`, `ride_messages`, `sos_alerts`,
  `disputes`, `settlements`, `refunds`, wallet ledgers, `notification_logs`.**
  None are joined by the four critical queries. Seeding them adds cost and
  cleanup surface for no measured win.
- **Synthetic drivers, vehicles, or driver documents.** Reuse real ones.

---

## 2. Per-table column specs

Enum values cited from `002_enums.sql` plus later `ADD VALUE` migrations. The
live `ride_status` enum is: `scheduled, requested, accepted, driver_arrived,
in_progress, completed, cancelled, no_drivers, returning`
(`002_enums.sql:62-65` + `031_advance_booking.sql:10` adds `scheduled` +
`075_ride_status_returning.sql:14` adds `returning`).

### 2.1 `users` (synthetic riders) — `003_m1_auth.sql:22-35`

| Column | Value / rule |
|---|---|
| `id` | BIGSERIAL, auto. Capture the generated id range for FK sourcing + cleanup. |
| `code` | Auto default `USR000001…` — do **not** override. |
| `phone` | **Reserved synthetic range — see §5.** `TEXT UNIQUE NOT NULL`. Must match app regex `^\+91[6-9]\d{9}$` (`auth.validator.ts:5`, re-enforced `rides.service.ts:85`) if these accounts also log in during the ramp. |
| `name` | `'LT Rider <n>'` — nullable but set it as a secondary human-visible tag and to make admin-list `search` (`admin.repository.ts:1373` ILIKE on `u.name`) exercise realistically. |
| `email` | Secondary tag: `loadtest+<code>@ocar.invalid`. `email` is `CITEXT` with **no UNIQUE constraint** (`003_m1_auth.sql:28`) so reuse of a common domain is safe. |
| `status` | `user_status` — `'active'` for essentially all (`002_enums.sql:8`). |
| `referral_code` | Leave default (`gen_random_uuid()::TEXT`, UNIQUE) — do not set. |
| `rating_avg`, `total_ratings` | Added `009_m7_safety.sql:13-15`, NOT NULL default 0. Optional backfill from seeded ratings. |

### 2.2 `rides` (1,000,000) — `007_m5_booking.sql:133-175` + later ALTERs

| Column | Type / constraint | Seed rule |
|---|---|---|
| `user_id` | NOT NULL FK→users | Random synthetic rider; skew so a minority are power users (long history). |
| `driver_id` | NULL FK→drivers | NULL only for `no_drivers` and cancelled-before-acceptance; else a random **real** driver. |
| `session_id` | NULL FK→driver_sessions | **NULL** for all historical rows (§1). |
| `vehicle_id` | NULL FK→driver_vehicles | Chosen driver's primary vehicle (for `getAdminRideById` join, `admin.repository.ts:1453`); NULL if no driver. |
| `category_id` | **NOT NULL** FK→vehicle_categories | One of the 5 seeded categories (`016_seed.sql:3-8`). Distribution §3. |
| `ride_type` | **NOT NULL** `ride_type` | `one_way`/`round_trip`/`rental` (`002_enums.sql:55`). Distribution §3. |
| `is_return_cab` | NOT NULL default false | `true` on a small share of `one_way` only (return-cab is one_way-only per `rate_cards` CHECK, `006_m4_pricing.sql:20-21`). |
| `status` | NOT NULL `ride_status` | Distribution §3. |
| `origin` | **NOT NULL** `geography(Point,4326)` | Random point inside a city bbox (§3). `ST_SetSRID(ST_MakePoint(lng,lat),4326)::geography`. |
| `destination` | NULL geography | Set for `one_way`/`round_trip`; NULL allowed for `rental`. |
| `origin_address`,`destination_address` | NULL TEXT | Human-plausible strings. |
| `origin_city_id`,`destination_city_id` | NULL FK→cities | Seeded city ids (`016_seed.sql:62-86`); admin city filter reads both (`admin.repository.ts:1366`). |
| `rider_phone`,`rider_name` | NULL | Mostly NULL; small % book-for-someone-else using another reserved-range phone. |
| `trip_hours` | NULL SMALLINT | Set for `round_trip`/`rental`; NULL for `one_way`. |
| `rental_package_id` | NULL FK→rental_packages | Set for `rental` to a seeded package for the category (`016_seed.sql:179-268`). |
| `scheduled_for` | NULL | Set only for the small `scheduled` slice. |
| `start_otp_hash`,`end_otp_hash` | NULL TEXT | **NULL** historically — no verifiable OTP needed; avoids per-row hashing (§6). |
| `requested_at` | NOT NULL default now() | **Date driver** — spread over 12 months (§3). All other timestamps derive from it. |
| `accepted_at … cancelled_at`, `return_started_at` | NULL TIMESTAMPTZ | Populate the prefix consistent with `status`, realistic gaps. `return_started_at` added `076_rides_return_started_at.sql:8`. |
| `actual_distance_km`,`actual_duration_min` | NULL NUMERIC(8,2) | Set for `completed` (near estimate ± noise). |
| `sos_triggered`,`sos_triggered_at` | NOT NULL false / NULL | `true` on a tiny fraction; SOS tables unseeded. |
| `review_flagged_at`,`review_reason` | NULL | Added `029_stuck_ride_review.sql:3`. Set on a tiny stuck-in-progress slice for edge cases. |
| `cash_discrepancy` | NOT NULL false | Added `064_cash_collection.sql:14`. `true` on small % of cash completed rides (admin filter `admin.repository.ts:1353`). |
| `cash_collected_amount` | NULL | Added `064`. Set for cash-channel completed rides. |
| `created_at`,`updated_at` | NOT NULL default now() | `created_at = requested_at`; `updated_at` = last transition time. |

`rides_active_idx` is partial to `requested/accepted/driver_arrived/in_progress`
(`007_m5_booking.sql:187-189`) — historical `completed`/`cancelled` rows are not
in it, so it stays tiny regardless of seed size.

### 2.3 `ride_status_history` — `007_m5_booking.sql:220-229`

One row per transition. `ride_id` NOT NULL FK; `to_status` NOT NULL; `actor`
NOT NULL `transition_actor` (`user, driver, system, admin, ride_completion,
timeout`, `002_enums.sql:66-68`); `from_status` NULL on first row. Generate the
chain matching each ride's final `status` with sensible actors (requested=user,
accepted/arrived/in_progress=driver, completed=ride_completion, cancelled=
user|driver|system, no_drivers=system, timeout for expiries). `created_at` = the
matching ride timestamp. Read by admin drill-down (`admin.repository.ts:1463-1469`)
and the correctness check.

### 2.4 `fare_snapshots` — `006_m4_pricing.sql:142-179` (+ `074`)

One per ride (`ride_id` UNIQUE, `006_m4_pricing.sql:144`) — every booking
computes an estimate at creation, so seed **1 per ride** including cancelled/
no_drivers. `ride_type` NOT NULL. `surge_multiplier` NOT NULL default 1.00,
CHECK 1.00–5.00 (`:150-151`) — 1.00 for most. Populate components (`base_fare,
distance_fare, time_fare, stop_fare, hour_surcharge, overage_fare, surge_fare,
total_estimated`) using the **same arithmetic as `lib/fare.ts`** so numbers are
internally consistent (§6 — SQL replication acceptable, TS bit-parity not
required). Branch by `ride_type`:
- `one_way`: `distance_fare = km*rate_per_km` (or `return_rate_per_km` if
  return-cab), `time_fare = min*rate_per_min`, floor at `min_fare`
  (`fare.ts:135-156`).
- `round_trip`: guaranteed `km_per_day`/day + overage +
  `driver_allowance_per_day` in `hour_surcharge` (`fare.ts:104-133`; columns
  added `074_round_trip_package_billing.sql:15-19`, backfilled 250km/₹300 `:42-44`).
- `rental`: `base_fare = package_fare` + overage (`fare.ts:75-92`).

For `completed` rides set `status='final'` (`fare_status`, `002_enums.sql:56`),
`total_final`, `actual_km`/`actual_min`, `finalised_at`. Else `status='estimate'`,
`total_final` NULL. Both admin list (`admin.repository.ts:1394`) and driver
history (`rides.repository.ts:1256`) read
`COALESCE(fs.total_final, fs.total_estimated)`. `billing_mode_snapshot`
(nullable, `078_city_billing_mode.sql:89`) may be NULL.

### 2.5 `payments` — `008_m6_payments.sql:7-27`

`ride_id` UNIQUE NOT NULL, `user_id` NOT NULL, **`driver_id` NOT NULL**,
`fare_snapshot_id` NOT NULL FK. Because `driver_id` is NOT NULL, **only rides
that reached a driver can have a payment** — seed for `completed` rides (+ a few
cancelled-after-acceptance with a fee). `amount` NOT NULL = fare total; `channel`
NOT NULL `payment_channel` (`cash_direct, company_qr, online_wallet, online_upi,
online_card, platform_wallet, razorpay_online`, `002_enums.sql:83-86` + `047:10`);
`status` mostly `completed` (`002_enums.sql:87-90`). Set
`commission_percent=15.00` (`016_seed.sql:229`),
`commission_amount = round(amount*0.15,2)`, `driver_earning = amount -
commission_amount`, `captured_at = completed_at`. Driver history reads
`p.driver_earning` (`rides.repository.ts:1257`); admin list reads `pay.status,
pay.channel` (`:1395`).

### 2.6 `ride_cancellations` — `007_m5_booking.sql:310-326`

One per cancelled ride (`ride_id` UNIQUE, `:312`). `actor` `cancel_actor`
(`user, driver, admin, system`); `stage` `cancel_stage` (`before_dispatch,
before_acceptance, after_acceptance, after_arrival, in_progress`,
`002_enums.sql:75-77` + `031:14`). Set the matching `cancelled_by_*_id`. Admin
list reads `rc.reason_code, rc.reason, rc.actor` (`admin.repository.ts:1396`).

### 2.7 `ratings` (+ optional `rating_tags`) — `009_m7_safety.sql:30-56`

Only on `completed` rides. `ride_id`+`direction` UNIQUE (`:41`) — at most one
`user_to_driver` and one `driver_to_user` per ride (`002_enums.sql:108`). `score`
SMALLINT CHECK 1–5 (`:34`), skew high (mostly 4–5). Set `from_*_id`/`to_*_id` per
direction. `rating_tags.tag_id` → the 17 seeded `rating_tag_definitions`
(`009_m7_safety.sql:181-198`); `rating_tags` optional. Read by admin safety panel
(`admin.repository.ts:1476`) / correctness check.

### 2.8 `ride_stops` (optional, small %) — `007_m5_booking.sql:272-284`

Only if exercising multi-stop; `sequence` CHECK `>0`, UNIQUE `(ride_id,sequence)`
(`:275,283`), `location` NOT NULL. Keep to a few % of rides; not read by any of
the four critical list queries.

---

## 3. Distribution requirements

**Dates (12 months).** Spread `requested_at` uniform-random across the trailing
365 days, then a mild weekday/evening skew (more Fri–Sun, 08–11 / 18–22 IST).
Uniform-random alone is acceptable and does not change which index the critical
queries use — they all `ORDER BY requested_at DESC` over full history
(`admin.repository.ts:1404`, `rides.repository.ts:1263`) and filter by
`requested_at::date` ranges (`admin.repository.ts:1357-1363`); only genuine
spread across the range matters, not intra-day shape. The mild skew is cheap and
makes the demo believable.

**Status distribution (mirror real proportions):**

| status | share | notes |
|---|---|---|
| `completed` | ~72% | carry payments + ratings + full history |
| `cancelled` | ~18% | spread across `cancel_stage`, mostly `before_acceptance` |
| `no_drivers` | ~5% | driver_id NULL, no payment |
| `accepted`/`driver_arrived`/`in_progress` | ~1% each | live-edge set for correctness-check + active-index queries |
| `scheduled` | ~1% | with `scheduled_for` (+ `ride_advance_meta` if that path is tested) |
| `returning` | <1% | round-trip return-leg edge case |

**Ride type** (`002_enums.sql:55`): ~70% `one_way`, ~20% `round_trip`, ~10%
`rental`; ~10% of `one_way` set `is_return_cab=true`.

**Vehicle category** (`016_seed.sql:3-8`): ~40% sedan, ~30% hatchback, ~20% suv,
~7% van, ~3% luxury — consistent with the attached driver's actual vehicle
category.

**Geography — real bounding boxes** (`017_city_boundaries.sql:6-25`; centroids
`016_seed.sql:71-85`; BBSR boundary later widened `033`/`055`/`096` — use current
merged one if present):

| City | slug | bbox (lng/lat) | centroid |
|---|---|---|---|
| Bhubaneswar | `bhubaneswar` | 85.75–85.92, 20.20–20.36 | 85.8245, 20.2961 |
| Cuttack | `cuttack` | 85.82–85.93, 20.42–20.52 | 85.8830, 20.4686 |
| Puri | `puri` | 85.79–85.88, 19.77–19.85 | 85.8315, 19.8135 |

Distribute ~60% BBSR, ~30% CTC, ~10% Puri. `origin`/`destination` = random
points inside the origin city's bbox; occasional cross-city pairs (BBSR↔CTC) for
round-trip/return-cab realism. Never global-random coords.

**Driver distribution:** draw `driver_id` from real active drivers only; skew so
a minority did a disproportionate share (power-law-ish) — makes driver-history
depth and `rides_driver_idx` selectivity realistic.

---

## 4. Referential-integrity build order

FKs verified across `003–011`. Parent rows first:

1. **Reference data — present, verify only:** `cities`, `vehicle_categories`,
   `rate_cards` (incl. `074` round_trip cols), `stop_charges`, `rental_packages`
   (`016_seed.sql`). Confirm real drivers' `driver_vehicles` + `drivers.city_id`
   (`082_driver_city_id.sql:8`) exist.
2. **`users`** (synthetic) — `generate_series` → `INSERT...SELECT`.
3. **`rides`** — `generate_series` → `INSERT...SELECT`, choosing
   user/driver/category/city/status/type/dates/points set-based with `random()` +
   PostGIS constructors. Capture generated `id` range.
4. **Ride children (all depend only on `rides`, parallelizable):**
   `fare_snapshots` (1:1), `ride_status_history` (1:many via unnest/LATERAL of
   the status chain), `ride_cancellations` (cancelled only), `ride_stops`
   (optional).
5. **`payments`** — depends on `rides` **and** `fare_snapshots`
   (`fare_snapshot_id` NOT NULL) → after step 4.
6. **`ratings`** (+ `rating_tags`) — after `rides`; completed only.

**All steps are set-based (`generate_series` + `INSERT...SELECT`).** Nothing needs
per-row looping: OTP hashes are NULL (§2.2) and fares use in-SQL arithmetic
(§2.4/§6), so no per-row bcrypt or TS call forces a loop. This is the fast path.

---

## 5. Safety tagging convention

`users.phone` is `TEXT UNIQUE NOT NULL` (`003_m1_auth.sql:26`) and, for accounts
that also log in during the ramp, must satisfy `^\+91[6-9]\d{9}$`
(`auth.validator.ts:5`; `rides.service.ts:85` for `rider_phone`). Real drivers'
phones are untouched (`LOAD_TEST_PLAN.md:53,63`), so only `users.phone` collision
matters.

**Proposal — reserved block `+919999XXXXXX`:** numbers `9999000000`–`9999999999`
(first digit `9` satisfies `[6-9]`), 1,000,000 unambiguous slots, matched for
cleanup by `phone LIKE '+919999%'`. Assign sequentially from `+919999000000`.

**Secondary tags (so cleanup never depends on one column):**
- `users.name = 'LT Rider <n>'`
- `users.email = 'loadtest+<code>@ocar.invalid'` (`email` non-unique CITEXT,
  `003_m1_auth.sql:28` — safe to reuse the domain)

**Cleanup** deletes children first (payments → ratings/rating_tags →
ride_cancellations → ride_status_history → fare_snapshots → rides) filtered by
`rides.user_id IN (synthetic users)`, then the synthetic `users`. The child
teardown order is already proven in the driver-deletion cascade
(`admin.repository.ts:427-442`) — mirror it.

**No new `is_synthetic` column is needed** — the phone prefix + `user_id` lineage
make every seeded row reachable and deletable. A column would touch the hot
`rides` table for zero query benefit (YAGNI).

**Required human check before use:** run `SELECT count(*) FROM users WHERE phone
LIKE '+919999%'` on the actual staging DB and confirm 0 (the `9999` mobile series
*is* allocated to real operators in India — the guarantee is "no real row in
*this staging DB* uses it", not "globally impossible"). If non-zero, pick another
`+919XXX` block returning 0. See §7.

---

## 6. Performance / practicality notes (for the script author)

- **Bulk method:** `generate_series(1,1000000)` + `INSERT ... SELECT` per table
  (§4), batched (50k–100k rows/txn) to bound WAL and lock duration. `COPY` is an
  option for `rides` if the generator moves client-side, but set-based
  `INSERT...SELECT` keeps PostGIS point construction + fare arithmetic in-DB and
  is simpler; prefer it unless load time is unacceptable.
- **No INSERT triggers fire.** `set_updated_at()` is **`BEFORE UPDATE` only** on
  every table involved (`014_triggers.sql:11-33`, plus the inline
  `trg_*_updated_at` in `006`/`007`/`008`/`011` — all `BEFORE UPDATE`). Bulk
  INSERTs pay no per-row trigger cost. Set `created_at`/`updated_at` explicitly.
- **FK validation** on 1M `rides` inserts checks user/driver/category/city PKs —
  fast against PK indexes; keep referenced sets pre-loaded and `ANALYZE`d.
- **Drop-and-rebuild the full-history secondary indexes** on the big tables
  (standard bulk-load practice). Drop before load, `CREATE INDEX` after:
  `rides_user_idx`, `rides_driver_idx`, `rides_origin_gix`
  (`007_m5_booking.sql:178-203`) + the `057_rides_fk_indexes.sql` /
  `058_financial_join_indexes.sql` indexes; `fare_snapshots_ride_idx`
  (`006:181`); `payments_ride_idx`/`payments_driver_idx` (`008:29,32`);
  `ride_status_history_ride_idx` (`007:231`). **Do NOT drop** the partial
  active-only indexes (`rides_active_idx` etc.) — historical rows don't enter
  them, so they stay tiny during load.
- **`ANALYZE` every seeded table** after load + index rebuild, before any
  before/after timing — the "no more than 20% slower" comparison
  (`LOAD_TEST_PLAN.md:103`) is meaningless against stale planner stats.
- **Autovacuum:** the churn-table tuning in
  `2026-07-26-db-loadtest-readiness-design.md` §3 targets the *live* path; the
  bulk load is append-only. Run a manual `VACUUM ANALYZE` post-load.
- Consider `SET LOCAL synchronous_commit = off` for the load session (Neon) to
  speed inserts; irrelevant to durability of throwaway seed data.

---

## 7. Open questions / assumptions needing a human decision

1. **Reserved phone block (blocking).** §5 proposes `+919999XXXXXX`. No reserved
   test range exists anywhere in the codebase (searched `api/src`). A human must
   (a) approve the block and (b) confirm `SELECT count(*) FROM users WHERE phone
   LIKE '+919999%'` = 0 on the real staging DB before use.
2. **Synthetic-rider count.** `LOAD_TEST_PLAN.md` §4 needs 6,000 concurrent
   riders; 1M rides need owners. Assumption: ~50,000 synthetic riders (~20
   rides each, realistic history depth, 6,000 reused for live traffic). Confirm.
3. **How many real active drivers exist in staging?** The 1M rides' `driver_id`
   pool = the reused real drivers (`LOAD_TEST_PLAN.md:53`). Target is 400 live
   drivers (§4); the code doesn't reveal how many onboarded drivers staging holds.
   Confirm the count and whether all get history or only the ~400 that go live.
4. **Fare arithmetic parity (minor).** §2.4/§6 replicate `lib/fare.ts` in SQL for
   speed. Confirm "internally consistent, not bit-identical to the TS engine" is
   acceptable for historical rows (it affects only displayed rupee values, not
   the four critical query plans).
5. **Exact status/type/geo percentages** in §3 are proposed defaults mirroring
   typical ride-hailing proportions — confirm or adjust to real Ocar ratios.
