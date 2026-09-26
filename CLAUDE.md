# Ocar — Cab Booking Platform

Intercity cab booking platform for Odisha (Bhubaneswar ↔ Cuttack ↔ Puri).
Turborepo + pnpm workspaces monorepo. Build is module-by-module (M01–M12).

---

## Stack

| Layer | Tech |
|---|---|
| API | Express 4, TypeScript 5, Zod validation |
| DB | PostgreSQL 18 + PostGIS, pg pool. Local dev uses Docker (see Database Setup below). Prod and staging run on AWS RDS (`infra/terraform/rds.tf`), migrated off Neon on 2026-08-25 — see `docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md` |
| Cache/Queues | Redis protocol (ioredis client), BullMQ. Prod and staging run on AWS ElastiCache, Valkey engine, single node (`infra/terraform/elasticache.tf`) — replaced the external Redis Cloud instance |
| Real-time | Socket.io v4 (attached to same HTTP server) |
| Auth | JWT access + refresh; SHA-256 refresh hash stored in DB |
| Payments | Razorpay + driver/user wallet ledger (M08 done) |
| Storage | AWS S3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) |
| OTP | SHA-256 hash of numeric OTP stored in DB/Redis (6-digit login OTP, 4-digit ride start/end OTP) |
| Observability | Pino (JSON logs) + OTel tracing + prom-client metrics, shipped by one Grafana Alloy agent per host to Grafana Cloud (Loki/Mimir/Tempo) — see `docs/superpowers/specs/2026-08-08-observability-stack-design.md`. Every log line and metric series carries a `color` label (`blue`/`green`, from `ALLOY_COLOR`) since the 2026-08-30 blue/green migration. `node_exporter` is filtered to ~15 metric families (`config.alloy`'s `prometheus.relabel "node"`) after unfiltered per-host cardinality (~500-700 series/host) tipped Grafana Cloud's 15,000 active-series cap during that migration's repeated instance churn — see `docs/OPS_RUNBOOK.md`'s "Diagnose a failed blue/green deploy" section if `up`/live-instance queries ever come back empty despite a healthy fleet. |
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
Ride OTPs are **4 digits** (`generateOtp(RIDE_OTP_LENGTH)`, `RIDE_OTP_LENGTH` from `@/constants/limits`) — shorter than login OTPs.
Auth OTPs (login) use Redis + SHA-256 via `consumeOtp()` and are **6 digits** (`OTP_LENGTH`) — different flow entirely.

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
Rate cards are city-scoped as of migration 078: `city_id IS NULL` = global default
(applies to any city without its own override), same NULL-fallback convention as
`surge_events.category_id IS NULL`. Current rate for a city =
`WHERE effective_to IS NULL AND (city_id = $cityId OR city_id IS NULL) ORDER BY city_id NULLS LAST LIMIT 1`.
Uniqueness for "current row" is per `(COALESCE(city_id, 0), category_id, ride_type)`,
not just `(category_id, ride_type)` — a city override and the global row can coexist.

### City boundaries are admin-owned
`cities.boundary` (Polygon, 4326) is edited by admins in the app (`/cities` → "Edit boundary",
`/api/v1/admin/geo/cities/:id/boundary[/preview]`), not by migrations. **Never write
`UPDATE cities SET boundary ...` in a migration** once this ships — it silently overwrites what
admins drew (083 clobbering 055 is exactly how Khordha↔Bhubaneswar broke until 096). Fresh DBs
(dev `--fresh`, staging) start from the 096 baseline, not prod's edited shapes.
`findContainingCity` only considers `status = 'active'` cities and breaks overlap ties by
smallest area → nearest centroid → id, so overlapping boundaries (Bhubaneswar/Cuttack) are safe.
Writes go through `admin.repository.ts` (`FOR UPDATE` + millisecond-precision `updated_at`
compare; 409 `BOUNDARY_CHANGED` on a stale save) — never `geo.repository.updateCity`.

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

### S3 document storage
- `uploadFile(file, folder)` — uploads to S3, returns public URL in prod / MinIO URL in dev
- `getPresignedUrl(fileUrl, expiresIn=3600)` — pass-through in dev (bucket is public), signed URL in prod
- Dev bypass: when `S3_BUCKET_NAME` is empty, `uploadFile` returns a placeholder URL without uploading
- Admin driver detail endpoint calls `getPresignedUrl` on all doc URLs before returning — no frontend change needed

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
- `user:{userId}` — private channel per user (joined on connect if role=user)
- `ride:{rideId}` — user + driver tracking a ride (joined via `join:ride` event)
- `admin:ops` — live map + shared ops channel for admins (joined on connect if role=admin)

Server initialised in `api/src/websocket/socket.server.ts`.
`getIO()` — get the io instance from anywhere in the API.
`socketEvents.*` — typed emit helpers, including `sendNotification(ownerType, ownerId, data)` which emits `notification:new` to the owner's room (or `admin:ops` for admins).

---

## Module Build State

### ✅ DONE

| Module | Migration | Backend | Frontend |
|---|---|---|---|
| M01 — Auth & OTP | 003_m1_auth.sql | auth module | admin login, user/driver OTP flow |
| M02 — Drivers & Users | 003_m1_auth.sql | drivers module | driver onboarding (3-step) |
| M03 — Vehicles | 004_m2_vehicles.sql | vehicles module | admin vehicles page (4-tab) |
| M04 — Admin Core | — | admin module | admin dashboard layout, driver approval |
| M05 — Geo & Location | 005_m3_geo.sql | geo module | admin cities page |
| M06 — Pricing & Fare | 006_m4_pricing.sql | pricing module | admin rate cards + surge UI |
| M07-A — Rides backend | 007_m5_booking.sql | rides module | — |
| M07-B — Rides frontend | — | — | driver GoOnline/ActiveRide flow, user ride booking + tracking |
| M08 — Payments | 008_m6_payments.sql + 011_wallet.sql | payments module (Razorpay webhook, wallet, ledger, commission) | admin payments page, user/driver wallet pages |
| M09 — Safety | 009_m7_safety.sql | ratings/SOS/disputes services | admin disputes + SOS pages; user rating flow |
| M10 — Notifications | 013_messaging.sql + 034_device_tokens.sql + 035_notifications_feed.sql + 036_notification_templates.sql | notifications module (SMS via Fast2SMS + push via FCM fully live; `notification_logs` doubles as a per-owner in-app feed with read/unread state; `notifyOwner()`/`notifyAllAdmins()` persist + push + socket-emit in one call; `notification_templates` render engine — worker fully rewired off hardcoded strings) | push registration (FCM) in all three apps; in-app notification bell/feed live in all three (driver bottom sheet, user `/notifications` page, admin dropdown) with live socket updates + foreground toast; admin "Notification Templates" config page for editing SMS/push copy |
| M11 — Live Map | 010_m8_config.sql (config/flags portion still a stub) | admin socket-fed driver location endpoints | admin live-map page (`LiveMap.tsx`, real-time via Socket.io) |
| M12 — Analytics | — | analytics module (repository/service/routes) | admin analytics page (revenue/rides/driver charts) |

### 🔲 TODO

| Module | Status |
|---|---|
| Config/Flags | `010_m8_config.sql` (`system_config`, `feature_flags`) is still a stub — no admin UI or backend reads it. Note: `notification_templates` (also part of the M8 diagram) is done — see M10 above; it shipped ahead of the rest of M8 because the notification feature needed it. |

---

## API Routes (mounted in app.ts)

```
/api/v1/auth/*         — OTP login, admin login, token refresh
/api/v1/drivers/*      — driver profile, documents (upload to S3), vehicles, onboarding
/api/v1/vehicles/*     — vehicle categories, brands, models (public lookup)
/api/v1/admin/*        — admin CRUD (drivers, vehicles, pricing, geo, users)
/api/v1/geo/*          — cities, nearest city, GPS track flush
/api/v1/pricing/*      — fare estimate, rate cards, rental packages
/api/v1/rides/*        — sessions (online/offline/location), ride booking & lifecycle
/api/v1/payments/*     — driver/user wallet, Razorpay webhook
/api/v1/safety/*       — ratings (GET tags, POST rating), SOS, disputes
/api/v1/users/*        — user profile (GET/PATCH /me)
/api/v1/notifications/*                — device token register/unregister; in-app feed:
                                          GET / (list, cursor-paginated), GET /unread-count,
                                          PATCH /:id/read, POST /read-all
/api/v1/admin/geo/cities/:id/boundary — GET / PUT / DELETE (+ POST /preview): city boundary editor,
                                          super_admin + ops_admin; 1 MB JSON body limit on this prefix only
/api/v1/admin/notification-templates/* — super_admin only: GET / (list), PATCH /:id (edit,
                                          bumps version), PATCH /:id/active (toggle)
/api/v1/rides/:id/messages             — POST (send, rate-limited), GET (list), PATCH /read
                                          (mark read) — in-ride chat between rider and driver
```

---

## Admin Dashboard Pages

| Page | Status |
|---|---|
| overview | ✅ live (real aggregate stats; layout SOS badge wired to real data) |
| drivers | ✅ live (list, detail slide-over, approve/reject/suspend) |
| vehicles | ✅ live (categories, brands, models, fleet — 4 tabs) |
| cities | ✅ live |
| pricing | ✅ live (rate cards + surge events) |
| disputes | ✅ live (wired to safety backend; hidden in DEMO_MODE) |
| sos | ✅ live (wired to safety backend; hidden in DEMO_MODE) |
| payments | ✅ live (wired to payments backend; hidden in DEMO_MODE) |
| users | ✅ live (user list) |
| rides | ✅ live (wired to admin rides backend; search, status filter, pagination) |
| live-map | ✅ live (real-time driver tracking via Socket.io) |
| analytics | ✅ live (revenue, rides, driver charts) |
| config/notification-templates | ✅ live (edit SMS/push copy per template, version bump on save, active/inactive toggle) |

---

## Known UI Caveats (not bugs — intentional placeholders)

### User app
- Home "recent trips" now comes from a real API; saved places, popular routes, and promo banner are still **hardcoded constants**
- Profile "Account" menu items (Saved places, Payment methods, Safety, Help & Support) are non-functional — no navigation wired yet. **Notifications is now live** (real in-app feed, wired)
- Payment method is display-only "Cash" — no payment selection flow yet
- "Add new rider" (For me sheet) is `disabled`. Multi-stop is live across **all** ride types: round-trip/rental add stops on their own pages, and one-way adds stops on `/select-ride` (routes through the waypoints for true detour distance since one-way is per-km; round-trip stays a flat per-stop fee). The `/search` "Add stops" pill just hints "set destination, add stops next".
- Bottom nav: only **My Trip** and **Profile** are active — Messages and Help show "SOON"
- Round-trip booking has a dedicated flow (`/round-trip` page → search → `/select-ride`); passes `rideType: 'round_trip'` and computed `tripHours` to the booking API. Rental fare differentiation is not yet wired.
- Message driver button on ride tracking screen is now live (in-ride chat screen)

### Driver app
- Earnings page now fetches real data; no remaining `DemoBlock`/mock swaps in Earnings, Wallet, or active-ride screens
- In-ride chat is live, with entry points on both active-ride screens

### Admin portal
- No remaining known caveats — overview, live-map, and analytics are all wired to real endpoints

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
api/src/lib/storage.ts             — S3 uploadFile(), getPresignedUrl(), deleteFile()
api/src/middleware/auth.middleware.ts — authenticate() — sets req.user/driver/admin
api/src/jobs/queues/index.ts       — BullMQ queue instances (NOTIFICATIONS, GPS_FLUSH, etc.)
api/src/jobs/processors/broadcast.processor.ts — ride broadcast fan-out
api/src/jobs/workers/notifications.worker.ts — sends SMS/push for 6 events via renderTemplate()
api/src/websocket/socket.server.ts — Socket.io init + socketEvents helpers (incl. sendNotification)
api/src/observability/tracing.ts   — OTel SDK init, imported first line of server.ts; trace_id
                                      feeds logger.ts's mixin so every log line correlates to a span
api/src/observability/metrics.ts   — prom-client Registry + /metrics: http_request_duration_seconds
                                      (method/route/status_code), pg_pool_connections, bullmq_queue_job_counts
api/src/modules/notifications/notifications.service.ts — notifyOwner()/notifyAllAdmins(): persist
                                                           feed row + push + socket emit in one call
api/src/modules/notifications/templates.service.ts      — renderTemplate(slug, channel, context, locale)
api/src/modules/ride-chat/                         — in-ride chat module: ride-chat.repository.ts,
                                                      ride-chat.service.ts, ride-chat.controller.ts,
                                                      ride-chat.routes.ts, ride-chat.types.ts

apps/admin/lib/api.ts              — axios instance (admin)
apps/admin/lib/auth.ts             — admin login helpers
apps/admin/lib/admin-api.ts        — adminDriverApi, adminUserApi
apps/admin/lib/city-api.ts         — cityApi
apps/admin/lib/pricing-api.ts      — pricingApi
apps/admin/lib/vehicle-api.ts      — vehicleCategoryApi, fleetApi, vehicleDocApi
apps/admin/lib/safety-api.ts       — safetyApi (SOS alerts, disputes)
apps/admin/lib/notifications-context.tsx — NotificationsProvider/useNotifications (bell dropdown)
apps/admin/lib/templates-api.ts    — templatesApi (notification templates admin page)

apps/user/lib/auth.ts              — user auth helpers
apps/user/lib/auth-context.tsx     — AuthContext provider
apps/user/lib/ride-api.ts          — ride booking + tracking API
apps/user/lib/safety-api.ts        — ratings + disputes API
apps/user/lib/notifications-context.tsx — NotificationsProvider/useNotifications (feed + toast)

apps/driver/src/lib/onboarding-api.ts — document upload, identity save, submit
apps/driver/src/store/useNotificationsStore.ts — notifications feed/bottom-sheet/toast state
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

# Admin portal tests (vitest + RTL; jsdom component tests, see apps/admin/vitest.config.ts)
cd apps/admin && pnpm test

# TypeScript check
cd api && npx tsc --noEmit
```

---

## CI/CD, Deploy, Staging & Pending Ops

Moved to `.claude/skills/deploy-ops/SKILL.md` (loads on demand when touching
`.github/workflows/*`, `infra/terraform/*`, or deploy/staging/CI work) — covers
the four CI/CD workflow files, blue/green deploy mechanics, the staging
environment spin-up/teardown, the Terraform bootstrap module, and the full
list of pending ops actions (kill switches, missing GitHub Environment gates,
branch protection).

---

## Security Rules (non-negotiable)

- No `error.message` in production API responses — only codes/safe messages
- JWT secrets in env vars only — never hardcoded anywhere
- Refresh token raw value NEVER stored — only SHA-256 hash in DB
- S3 bucket must be private in prod; use `getPresignedUrl()` for admin doc viewing
- `.env` is gitignored; `.env.example` is committed
- `pnpm-lock.yaml` is committed (NOT gitignored)
- No Co-Authored-By line in any commits
- No bash/sh/unix commands in package.json scripts (Windows environment)
- No chmod/chown anywhere
- PostGIS queries always use parameterized geography — never string concat
- SQL injection: only hardcoded column names in dynamic UPDATE builders

**Secret scanning**: this is a private repo, so GitHub's native secret scanning (`GitHub Secret Protection`) is a paid add-on ($19/mo per active committer), not free like it is on public repos — declined on cost. Mitigation in place instead: Trivy's `secret` scanner runs in `ci.yml` on every push/PR (fails the build on CRITICAL/HIGH findings). Known gap versus the paid product: no push protection (a secret can still land in a commit before CI runs) and no retroactive scan of existing git history — Trivy only checks the code at the commit that triggered the run. Revisit if budget changes or a leak ever happens.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
_GS=""
for _D in "${GSTACK_ROOT:-}" "$HOME/.claude/skills/gstack" "$HOME/.codex/skills/gstack" "$HOME/.factory/skills/gstack" "$HOME/.kiro/skills/gstack" "$HOME/.config/opencode/skills/gstack" "$HOME/.slate/skills/gstack" "$HOME/.cursor/skills/gstack" "$HOME/.openclaw/skills/gstack" "$HOME/.hermes/skills/gstack" "$HOME/.gbrain/skills/gstack" "$HOME/.gstack/repos/gstack"; do
  [ -z "$_GS" ] && [ -n "$_D" ] && [ -d "$_D/bin" ] && _GS="$_D"
done
[ -n "$_GS" ] && echo "GSTACK_OK: $_GS" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing (Aside first, the bundled gstack browser as fallback).
Use the resolved install path above for gstack file paths
(default: ~/.claude/skills/gstack).

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
