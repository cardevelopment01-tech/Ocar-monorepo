# Ocar — Cab Booking Platform

Intercity cab booking platform for Odisha (Bhubaneswar ↔ Cuttack ↔ Puri).
Turborepo + pnpm workspaces monorepo. Build is module-by-module (M01–M12).

---

## Repo Structure

```
cab-booking-platform/
├── api/                  Express + TypeScript backend
├── apps/
│   ├── user/             Next.js 16 (App Router) — passenger app
│   ├── driver/           Vite 5 + React 19 + React Router v6 — driver app
│   └── admin/            Next.js 16 (App Router) — ops portal
└── packages/             (shared config only, no shared runtime code yet)
```

---

## Stack

| Layer | Tech |
|---|---|
| API | Express 4, TypeScript 5, Zod validation |
| DB | PostgreSQL 18 (Docker) + PostGIS, pg pool |
| Cache/Queues | Redis (ioredis), BullMQ |
| Real-time | Socket.io v4 (attached to same HTTP server) |
| Auth | JWT access + refresh; SHA-256 refresh hash stored in DB |
| Payments | Razorpay (M08, stub) |
| OTP | SHA-256 hash of 6-digit numeric OTP stored in DB/Redis |
| User portal | Next.js 16.2.7, React 19, Tailwind v3, App Router |
| Driver portal | Vite 5, React 19, React Router v6, Zustand persist, Tailwind v3 |
| Admin portal | Next.js 16.2.7, React 19, Tailwind v3, App Router |

---

## Database Setup

```
Native PG18 on :5432  (don't use this)
Docker Postgres       container: ocar_postgres, port: 5434, db: ocar
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ocar
```

**Run migrations:**
```powershell
cd api && pnpm migrate          # runs new migrations only
cd api && pnpm migrate --fresh  # drops everything and reruns all (dev only)
```

**Connect directly:**
```
docker exec ocar_postgres psql -U postgres -d ocar
```

---

## Critical Invariants — Read Before Touching Anything

### Trigger function name
```sql
-- CORRECT (what exists in 014_triggers.sql)
EXECUTE FUNCTION set_updated_at()

-- WRONG (the spec docs sometimes say this — ignore it)
EXECUTE FUNCTION update_updated_at()
```

### OTP for ride start/end
Ride OTPs (trip_start, trip_end) use **SHA-256** via `hashOtp()` from `@/lib/otp`.
NOT bcrypt. NOT Redis. The hash is stored in `rides.start_otp_hash` / `rides.end_otp_hash`.
Auth OTPs (login) use Redis + SHA-256 via `consumeOtp()` — different flow entirely.

### PostGIS parameterized queries
**Never** build geography from string concatenation. Always use:
```sql
ST_SetSRID(ST_MakePoint($lng::float8, $lat::float8), 4326)::geography
-- or for LineString:
ST_MakeLine(
  ST_SetSRID(ST_MakePoint($lng1::float8, $lat1::float8), 4326),
  ST_SetSRID(ST_MakePoint($lng2::float8, $lat2::float8), 4326)
)::geography
```
ST_MakePoint takes **(lng, lat)** — longitude first.

### Rate card versioning
Never UPDATE rate_cards. Always INSERT new row + set `effective_to` on old row.
Current rate = `WHERE effective_to IS NULL`.

### `exactOptionalPropertyTypes: true`
Cannot pass `field: value | undefined` where `field?: value` is expected.
**Pattern:** build the object first, then conditionally set optional fields:
```typescript
const input: SomeType = { requiredField: value }
if (param !== undefined) input.optionalField = param
```
This pattern is required everywhere optional fields come from nullable sources.

### `now()` in partial index WHERE clauses
`now()` is STABLE not IMMUTABLE — cannot be used in index predicates.
Use equality comparisons against enum values instead (those ARE immutable).
```sql
-- WRONG
WHERE expires_at < now()
-- RIGHT
WHERE status = 'active'   -- enum comparison is IMMUTABLE
```

### Deferred FK pattern
When table A needs FK to table B which doesn't exist yet:
- Create column in A without FK constraint
- In B's migration, add `ALTER TABLE A ADD CONSTRAINT ... FOREIGN KEY ...`
Example: `fare_snapshots.ride_id` FK was added in 007 after `rides` was created.

---

## TypeScript Conventions

```typescript
// Router type annotation (prevents TS2742 portability error)
const router: IRouter = Router()

// BigInt IDs — DB IDs come back as bigint from pg
const id = BigInt(req.params['id']!)

// req.user / req.driver / req.admin are set by authenticate()
// req.user!.id  → bigint (for user-authenticated routes)
// req.driver!.id → bigint (for driver-authenticated routes)
// req.admin!.id  → bigint (for admin-authenticated routes)
```

---

## Auth Patterns

| Principal | Token location | JWT claim |
|---|---|---|
| User | localStorage `ocar_user_token` | `role: 'user'` |
| Driver | Zustand persist `ocar_driver_auth` | `role: 'driver'` |
| Admin | localStorage `ocar_admin_token` + cookie | `role: 'admin'` |

Auth endpoints:
- `POST /api/v1/auth/otp/request` — body: `{ phone, role }` — for users and drivers
- `POST /api/v1/auth/admin/login` — body: `{ email, password }`

Driver status enum: `pending_docs | pending_approval | active | suspended | banned`
Vehicle state enum: `pending | active | inactive | blacklisted`

---

## Socket.io

Rooms:
- `driver:{driverId}` — private channel per driver (joined on connect if role=driver)
- `ride:{rideId}` — user + driver tracking a ride (joined via `join:ride` event)
- `admin:ops` — live map for admin (joined on connect if role=admin)

Server initialised in `api/src/websocket/socket.server.ts`.
`getIO()` — get the io instance from anywhere in the API.
`socketEvents.*` — typed emit helpers.

---

## Module Build State

### ✅ DONE

| Module | Migration | Backend | Admin UI |
|---|---|---|---|
| M01 — Auth & OTP | 003_m1_auth.sql | auth module | admin login |
| M02 — Drivers & Users | 003_m1_auth.sql | drivers module | drivers page |
| M03 — Vehicles | 004_m2_vehicles.sql | vehicles module | vehicles page (4-tab) |
| M04 — Admin Core | — | admin module | dashboard layout, driver approval |
| M05 — Geo & Location | 005_m3_geo.sql | geo module | cities page |
| M06 — Pricing & Fare | 006_m4_pricing.sql | pricing module | rate cards + surge UI |
| M07-A — Rides backend | 007_m5_booking.sql | rides module | — |

### 🔲 NEXT: M07-B — Rides frontend connection

Driver app:
- `useSessionStore.ts` — go online/offline, session state (Zustand persist)
- `useRideStore.ts` — incoming request, active ride state
- Socket.io client connection in driver app
- Pages to wire: GoOnline/*, ActiveRide/* (IncomingRequest, NavigateToPickup, OTPVerify, TripInProgress, TripEnd)

User app:
- Socket.io client for ride tracking
- Pages to wire: ride/book, ride/tracking/[id]

### 🔲 TODO (stubs exist)

| Module | Migration stub | Backend stubs |
|---|---|---|
| M08 — Payments | 008_m6_payments.sql | payments module (razorpay, wallet, settlements) |
| M09 — Safety | 009_m7_safety.sql | safety module (ratings, sos, disputes) |
| M10 — Notifications | — | notifications module (sms, push, voice, whatsapp) |
| M11 — Config/Flags | 010_m8_config.sql | — |
| M12 — Analytics | — | analytics module |

---

## Migrations Map

```
001_extensions.sql     — PostGIS, pgcrypto, uuid-ossp
002_enums.sql          — ALL application enums (30+ types)
003_m1_auth.sql        — users, drivers, admins, refresh_tokens, otp_requests
004_m2_vehicles.sql    — vehicle_categories, vehicle_brands, vehicle_models,
                         driver_vehicles, driver_vehicle_documents,
                         driver_documents, daily_verifications
005_m3_geo.sql         — cities, gps_tracks (partitioned), place_geocode_cache
                         + deferred FK DO blocks for driver_sessions/rides → cities
006_m4_pricing.sql     — rate_cards, rate_card_history, stop_charges,
                         rental_packages, surge_events, fare_snapshots
007_m5_booking.sql     — driver_sessions, driver_session_history,
                         driver_location_snapshots, return_cab_routes,
                         rides, ride_status_history, ride_assignments,
                         ride_stops, ride_otp_events, ride_cancellations,
                         speed_alert_log
                         + ALTER TABLE fare_snapshots ADD FK ride_id → rides
                         + ALTER TABLE driver_session_history ADD FK ride_id → rides
008_m6_payments.sql    — STUB (payments, razorpay_orders, gateway_events)
009_m7_safety.sql      — STUB (ratings, sos_alerts, disputes, warnings)
010_m8_config.sql      — STUB (system_config, feature_flags)
011_wallet.sql         — STUB
012_audit.sql          — STUB
013_messaging.sql      — STUB
014_triggers.sql       — set_updated_at() function + triggers for M01-M03 tables
015_indexes.sql        — STUB (additional composite indexes)
016_seed.sql           — cities (Bhubaneswar/Cuttack/Puri), vehicle lookup data,
                         rate cards (5 categories × 3 ride types), stop charges,
                         rental packages (sedan + SUV)
```

---

## API Routes (mounted in app.ts)

```
/api/v1/auth/*         — OTP login, admin login, token refresh
/api/v1/drivers/*      — driver profile, documents, vehicles
/api/v1/vehicles/*     — vehicle categories, brands, models (public lookup)
/api/v1/admin/*        — admin CRUD (drivers, vehicles, pricing, geo, users)
/api/v1/geo/*          — cities, nearest city, GPS track flush
/api/v1/pricing/*      — fare estimate, rate cards, rental packages
/api/v1/rides/*        — sessions (online/offline/location), ride booking & lifecycle
```

---

## Key File Locations

```
api/src/config/index.ts            — env schema (Zod), config object
api/src/db/client.ts               — pg Pool
api/src/db/redis.ts                — ioredis client
api/src/db/migrate.ts              — migration runner
api/src/lib/fare.ts                — pure fare calculation engine
api/src/lib/otp.ts                 — OTP generate/hash/verify (SHA-256 + Redis)
api/src/lib/jwt.ts                 — sign/verify access tokens
api/src/lib/hash.ts                — sha256 helper
api/src/middleware/auth.middleware.ts — authenticate() — sets req.user/driver/admin
api/src/jobs/queues/index.ts       — BullMQ queue instances (NOTIFICATIONS, GPS_FLUSH, etc.)
api/src/jobs/processors/broadcast.processor.ts — ride broadcast fan-out
api/src/websocket/socket.server.ts — Socket.io init + socketEvents helpers
apps/admin/lib/api.ts              — axios instance (admin)
apps/admin/lib/auth.ts             — admin login helpers
apps/admin/lib/city-api.ts         — cityApi
apps/admin/lib/pricing-api.ts      — pricingApi
apps/admin/lib/vehicle-api.ts      — vehicleCategoryApi, fleetApi, vehicleDocApi
```

---

## Running Things

```powershell
# API dev server
cd api && pnpm dev

# Admin portal
cd apps/admin && pnpm dev

# Driver portal
cd apps/driver && pnpm dev

# User portal
cd apps/user && pnpm dev

# API tests (unit only pass cleanly; integration tests need proper TEST_DATABASE_URL)
cd api && pnpm test

# TypeScript check
cd api && npx tsc --noEmit
```

---

## Security Rules (non-negotiable)

- No `error.message` in production API responses — only codes/safe messages
- JWT secrets in env vars only — never hardcoded anywhere
- Refresh token raw value NEVER stored — only SHA-256 hash in DB
- `.env` is gitignored; `.env.example` is committed
- `pnpm-lock.yaml` is committed (NOT gitignored)
- No Co-Authored-By line in any commits
- No bash/sh/unix commands in package.json scripts (Windows environment)
- No chmod/chown anywhere
- PostGIS queries always use parameterized geography — never string concat
- SQL injection: only hardcoded column names in dynamic UPDATE builders
