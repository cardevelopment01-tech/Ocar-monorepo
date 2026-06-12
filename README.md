<div align="center">

<br />

<h1>🚖 Ocar</h1>

<p><strong>A production-grade, full-stack cab booking platform — built for scale, designed for India.</strong><br />
End-to-end ride management: driver onboarding · real-time GPS · fare engine · payments · analytics.</p>

<br />

[![Node.js](https://img.shields.io/badge/Node.js-22_LTS-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x_strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Express](https://img.shields.io/badge/Express-4.18-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL_18-PostGIS-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7_Alpine-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![pnpm](https://img.shields.io/badge/pnpm-9+-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)

[![Tests](https://img.shields.io/badge/tests-38_passing-22C55E?style=flat-square&logo=vitest&logoColor=white)](#-testing)
[![Modules](https://img.shields.io/badge/modules-9%2F12_complete-8B5CF6?style=flat-square)](#-module-roadmap)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](./docker-compose.yml)
[![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-EF4444?style=flat-square&logo=turborepo&logoColor=white)](https://turbo.build)
[![License](https://img.shields.io/badge/license-MIT-64748B?style=flat-square)](./LICENSE)

<br />

[**Quick Start**](#-quick-start) &nbsp;·&nbsp; [**Architecture**](#-architecture) &nbsp;·&nbsp; [**API Modules**](#-api-modules) &nbsp;·&nbsp; [**Testing**](#-testing) &nbsp;·&nbsp; [**Roadmap**](#-module-roadmap)

<br />

</div>

---

## What is Ocar?

Ocar is a **12-module monorepo** powering a full cab booking ecosystem — think Ola or Uber, built from the ground up with modern tooling and a clean architecture you can actually understand and extend.

It covers the complete lifecycle: a driver registers, gets approved, goes online, receives ride broadcasts, completes trips, earns money — and the platform handles every edge case along the way: OTP verification, geospatial matching, dynamic fare calculation, Razorpay payments, wallet settlements, SOS alerts, dispute resolution, and admin oversight.

The backend is raw `pg` queries over PostgreSQL + PostGIS (no ORM overhead), BullMQ for async jobs, Socket.IO for real-time events, and three frontend apps built with Next.js and React.

---

## Highlights

- **Phone + OTP auth** for users and drivers; **email + password** for admins — refresh token rotation, SHA-256 hashed storage, and 15-minute lockout on brute force
- **Geospatial driver matching** powered by PostGIS — `ST_DWithin`, partial indexes on active drivers, and sub-50ms lookup
- **Dynamic fare engine** with surge pricing, zone-aware rates, and fare dispute flow
- **Ride broadcast system** — fan-out offers to up to 5 nearby drivers per round, 3 rounds max, auto-cancels on no acceptance
- **Razorpay integration** with webhook verification, wallet top-ups, driver settlements, and refund lifecycle
- **BullMQ job queues** — GPS flush batching, broadcast orchestration, settlement processing, OTP cleanup, partition pre-creation
- **Monthly table partitioning** — `gps_tracks`, `notification_logs`, and audit tables partitioned by month for O(1) retention
- **Safety layer** — SOS with severity levels, ride ratings with tagged feedback, dispute lifecycle with evidence uploads
- **Full admin dashboard** — driver approval, vehicle management, pricing config, live disputes, SOS triage, ride history, user management, payments
- **Three frontend apps** — user booking app (Next.js), driver app (Vite + React), admin dashboard (Next.js) — all fully dark-themed and mobile-first
- **Confirmation UX** — destructive actions (go offline, sign out, dispute resolve, SOS triage) are all gated behind confirmation dialogs

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Monorepo (Turborepo)                      │
│                                                                   │
│   apps/user (Next.js 16)    apps/driver (Vite)   apps/admin      │
│        :3000                     :3001           (Next.js) :3002  │
│           │                        │                  │           │
│           └────────────────────────┴──────────────────┘           │
│                              HTTP / WS                            │
│                                 │                                 │
│                         api/ (Express 4)                         │
│                              :4000                               │
│                                 │                                 │
│            ┌────────────────────┼────────────────────┐           │
│            │                    │                    │           │
│      PostgreSQL 18          Redis 7              BullMQ          │
│       + PostGIS 3.4        (cache / OTP)       (job queues)      │
│         :5434 (Docker)          :6379          Workers ×6        │
│                                                                   │
│                     S3 / MinIO — file storage                    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision       | Choice            | Why                                                                                             |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| ORM            | Raw `pg` Pool     | Zero abstraction overhead; full control over spatial queries and CTEs                           |
| Spatial        | PostGIS           | `geography` type gives accurate distance at Indian latitudes; partial indexes on active drivers |
| Queue          | BullMQ + Redis    | Native fan-out, per-job TTL, priority lanes, Bull Board UI                                      |
| Partitioning   | Monthly range     | `DROP TABLE` for retention vs `DELETE` — orders of magnitude faster on GPS/log tables           |
| Token security | SHA-256 hash only | Bare refresh token never persisted — compromised DB row is useless                              |
| Validation     | Zod everywhere    | Runtime safety at API boundaries; auto-typed TS inference from schemas                          |

---

## Tech Stack

<table>
<tr>
<td valign="top" width="50%">

**Backend**

| Layer         | Technology                  |
| ------------- | --------------------------- |
| Runtime       | Node.js 22 LTS              |
| Language      | TypeScript 5 (strict)       |
| Framework     | Express 4.18                |
| Database      | PostgreSQL 18 + PostGIS     |
| Cache / Queue | Redis 7 + BullMQ 5          |
| Auth          | JWT + OTP (phone-based)     |
| Payments      | Razorpay                    |
| Storage       | AWS S3 / MinIO              |
| Real-time     | Socket.IO v4                |
| File uploads  | Multer (memoryStorage)      |
| Validation    | Zod 3                       |
| Testing       | Vitest 1 + Supertest        |

</td>
<td valign="top" width="50%">

**Frontend**

| App             | Technology                               |
| --------------- | ---------------------------------------- |
| User app        | Next.js 16, React 19, Framer Motion      |
| Driver app      | Vite 5, React 19, React Router v6        |
| Admin dashboard | Next.js 16, React 19                     |
| Styling         | Tailwind CSS v3                          |
| State           | Zustand (persist)                        |
| Maps            | Leaflet                                  |
| HTTP            | Axios                                    |
| UI primitives   | Radix UI                                 |

**Infrastructure**

| Tool           | Purpose                             |
| -------------- | ----------------------------------- |
| Turborepo      | Monorepo task orchestration         |
| pnpm 9         | Workspace package management        |
| Docker Compose | Local Postgres + Redis              |
| tsx            | TypeScript runner (no compile step) |

</td>
</tr>
</table>

---

## Repository Structure

```
cab-booking-platform/
├── api/                          # Express API (primary backend)
│   ├── src/
│   │   ├── config/               # Zod-validated env config
│   │   ├── constants/            # Enums, error codes, rate limits
│   │   ├── db/
│   │   │   ├── client.ts         # pg Pool with typed query wrapper
│   │   │   ├── redis.ts          # ioredis connection
│   │   │   ├── migrate.ts        # Migration runner (--fresh flag)
│   │   │   └── migrations/       # 16 numbered SQL files (001–016)
│   │   ├── lib/                  # Shared utilities
│   │   │   ├── jwt.ts            # Access + refresh token helpers
│   │   │   ├── otp.ts            # OTP generate / hash / lock / rate-limit
│   │   │   ├── hash.ts           # bcrypt + SHA-256
│   │   │   ├── errors.ts         # Typed HTTP error factory
│   │   │   ├── storage.ts        # S3 / MinIO upload + delete
│   │   │   ├── fare.ts           # Fare calculation engine
│   │   │   └── pagination.ts     # Cursor + offset pagination
│   │   ├── middleware/           # Auth, role guard, validate, audit, rate-limit
│   │   ├── modules/              # Feature modules
│   │   │   ├── auth/             # ✅ M01/M02 — Phone OTP + admin login
│   │   │   ├── drivers/          # ✅ M02 — Driver onboarding flow
│   │   │   ├── vehicles/         # ✅ M03 — Vehicle catalogue lookup
│   │   │   ├── geo/              # ✅ M05 — City zones + geocoding
│   │   │   ├── pricing/          # ✅ M06 — Fare engine + surge
│   │   │   ├── rides/            # ✅ M07 — Booking + broadcast
│   │   │   ├── payments/         # ✅ M08 — Razorpay + wallet
│   │   │   ├── safety/           # ✅ M09 — SOS + disputes + ratings
│   │   │   ├── users/            # ✅ — User profile
│   │   │   ├── admin/            # ✅ — Ops dashboard API
│   │   │   ├── notifications/    # 🔜 M10 — SMS / push / WhatsApp
│   │   │   └── analytics/        # 🔜 M12 — Snapshots + reports
│   │   ├── jobs/
│   │   │   ├── queues/           # BullMQ queue definitions
│   │   │   ├── workers/          # 6 worker processes
│   │   │   └── processors/       # Individual job handlers
│   │   └── websocket/            # Socket.IO handlers + rooms
│   └── tests/
│       ├── unit/                 # lib/fare, lib/pagination
│       └── integration/          # m01–m09 (38 passing, 60 todo)
│
├── apps/
│   ├── user/                     # Next.js booking app (port 3000)
│   ├── driver/                   # Vite driver app (port 3001)
│   └── admin/                    # Next.js admin dashboard (port 3002)
│
├── docker-compose.yml            # Postgres (Docker :5434) + Redis
├── turbo.json                    # Turborepo pipeline
└── pnpm-workspace.yaml           # Workspace packages
```

---

## Quick Start

### Prerequisites

| Tool           | Version  | Check              |
| -------------- | -------- | ------------------ |
| Node.js        | ≥ 22 LTS | `node --version`   |
| pnpm           | ≥ 9      | `pnpm --version`   |
| Docker Desktop | Latest   | `docker --version` |

### 1 — Clone & Install

```bash
git clone https://github.com/cardevelopment01-tech/Ocar-monorepo.git
cd Ocar-monorepo
pnpm install
```

### 2 — Configure Environment

```bash
cp api/.env.example api/.env
```

At minimum, set these in `api/.env`:

```env
JWT_ACCESS_SECRET=   # openssl rand -hex 32
JWT_REFRESH_SECRET=  # openssl rand -hex 32
```

Everything else has safe defaults for local development.

### 3 — Start Infrastructure

```bash
pnpm docker:up
# Starts: PostgreSQL :5434, Redis :6379
```

### 4 — Run Migrations

```bash
pnpm migrate
# Use --fresh to wipe and rebuild from scratch (dev only)
```

### 5 — Start Development

```bash
pnpm dev
# API      → http://localhost:4000
# User app → http://localhost:3000
# Driver   → http://localhost:3001
# Admin    → http://localhost:3002
```

### 6 — Verify

```bash
curl http://localhost:4000/health
# → {"status":"ok","db":"ok","redis":"ok",...}
```

---

## Available Scripts

| Command                | Description                              |
| ---------------------- | ---------------------------------------- |
| `pnpm dev`             | Start all apps + API in watch mode       |
| `pnpm build`           | Build all packages for production        |
| `pnpm test`            | Run the full test suite                  |
| `pnpm test:api`        | Run API integration + unit tests only    |
| `pnpm lint`            | Lint all packages                        |
| `pnpm migrate`         | Apply pending migrations                 |
| `pnpm migrate --fresh` | Drop all tables and reapply from scratch |
| `pnpm docker:up`       | Start Postgres + Redis in Docker         |
| `pnpm docker:down`     | Stop Docker containers                   |
| `pnpm docker:logs`     | Tail Docker container logs               |

---

## Module Roadmap

| #   | Module            |   Status    |  Tests  | Description                                                        |
| --- | ----------------- | :---------: | :-----: | ------------------------------------------------------------------ |
| M01 | Foundation        | ✅ Complete |  8 / 8  | Health check, DB/Redis connectivity, request ID middleware         |
| M02 | Auth & Identity   | ✅ Complete | 14 / 14 | Phone OTP login, admin email auth, JWT refresh rotation            |
| M03 | Driver Onboarding | ✅ Complete | 13 / 13 | Personal info, vehicle, document uploads, resume flow              |
| M04 | Vehicle Catalogue | ✅ Complete |    —    | Categories, brands, models — public lookup endpoints               |
| M05 | Geolocation       | ✅ Complete |    —    | City zones, geocoding cache, driver GPS location tracking          |
| M06 | Pricing & Fare    | ✅ Complete |    —    | Base fare + per-km/min, surge scheduling, fare estimates           |
| M07 | Ride Management   | ✅ Complete |    —    | Booking, driver broadcast, OTP verification, full ride lifecycle   |
| M08 | Payments          | ✅ Complete |    —    | Razorpay orders, webhooks, wallet ledger, driver settlements       |
| M09 | Safety            | ✅ Complete |    —    | SOS alerts, ride ratings with tags, dispute lifecycle              |
| M10 | Notifications     | 🔜 Planned  |    —    | SMS, push, WhatsApp, voice — multi-channel delivery                |
| M11 | Config & Live Map | 🔜 Planned  |    —    | Feature flags, system config, live driver map                      |
| M12 | Analytics         | 🔜 Planned  |    —    | Revenue snapshots, ride stats, driver performance                  |

---

## API Modules

All routes are prefixed `/api/v1`.

### Auth — `/auth`

| Method | Path                  |  Auth  | Description                    |
| ------ | --------------------- | :----: | ------------------------------ |
| `POST` | `/auth/otp/request`   |   —    | Request OTP (user or driver)   |
| `POST` | `/auth/otp/verify`    |   —    | Verify OTP, receive JWT pair   |
| `POST` | `/auth/admin/login`   |   —    | Admin email + password login   |
| `POST` | `/auth/token/refresh` |   —    | Rotate access + refresh tokens |
| `POST` | `/auth/logout`        | Bearer | Revoke refresh token           |

OTP is rate-limited to **3 requests per 15-minute window**. Three wrong attempts locks verification for 15 minutes.

### Driver Onboarding — `/drivers`

| Method | Path                                           |  Auth  | Description                               |
| ------ | ---------------------------------------------- | :----: | ----------------------------------------- |
| `GET`  | `/drivers/me`                                  | Driver | Profile + onboarding status               |
| `POST` | `/drivers/onboarding/personal-info`            | Driver | Step 2 — personal details                 |
| `POST` | `/drivers/onboarding/vehicle-info`             | Driver | Step 3 — vehicle registration             |
| `POST` | `/drivers/onboarding/documents/identity`       | Driver | Step 4a — Aadhaar + license numbers       |
| `POST` | `/drivers/onboarding/documents/upload`         | Driver | Step 4b — identity photo uploads (≤ 5 MB) |
| `POST` | `/drivers/onboarding/documents/vehicle-upload` | Driver | Step 4c — vehicle doc uploads (≤ 5 MB)    |
| `GET`  | `/drivers/onboarding/documents`                | Driver | Document status (Aadhaar masked)          |
| `POST` | `/drivers/onboarding/submit`                   | Driver | Submit for admin review                   |

The onboarding step is persisted in the database — drivers can close the app and **resume exactly where they left off**.

### Vehicles — `/vehicles`

| Method | Path                               | Auth | Description                   |
| ------ | ---------------------------------- | :--: | ----------------------------- |
| `GET`  | `/vehicles/categories`             |  —   | All active vehicle categories |
| `GET`  | `/vehicles/brands`                 |  —   | All active vehicle brands     |
| `GET`  | `/vehicles/brands/:brandId/models` |  —   | Models for a specific brand   |

### Rides — `/rides`

| Method  | Path                       |  Auth  | Description                              |
| ------- | -------------------------- | :----: | ---------------------------------------- |
| `POST`  | `/rides/sessions/online`   | Driver | Go online, start a driver session        |
| `POST`  | `/rides/sessions/offline`  | Driver | Go offline, end active session           |
| `PATCH` | `/rides/sessions/location` | Driver | Push current GPS location                |
| `GET`   | `/rides/sessions/current`  | Driver | Get current active session               |
| `POST`  | `/rides`                   |  User  | Book a ride (triggers driver broadcast)  |
| `POST`  | `/rides/:id/accept`        | Driver | Accept a broadcast offer                 |
| `POST`  | `/rides/:id/arrived`       | Driver | Mark driver arrived at pickup            |
| `POST`  | `/rides/:id/start-otp`     | Driver | Start trip — OTP verified server-side    |
| `POST`  | `/rides/:id/end-otp`       | Driver | End trip — OTP verified server-side      |
| `GET`   | `/rides/:id`               | Bearer | Get ride detail + status                 |
| `GET`   | `/rides/me/history`        |  User  | Paginated ride history for user          |
| `GET`   | `/rides/me/trips`          | Driver | Paginated trip history for driver        |

### Payments — `/payments`

| Method | Path                         |  Auth  | Description                           |
| ------ | ---------------------------- | :----: | ------------------------------------- |
| `GET`  | `/payments/wallet/driver`    | Driver | Driver wallet balance + recent ledger |
| `GET`  | `/payments/wallet/user`      |  User  | User wallet balance + recent ledger   |
| `POST` | `/payments/webhook/razorpay` |   —    | Razorpay webhook (signature verified) |

### Safety — `/safety`

| Method | Path                 |  Auth  | Description                                    |
| ------ | -------------------- | :----: | ---------------------------------------------- |
| `GET`  | `/safety/tags`       | Bearer | Get rating tag definitions (`?direction=...`)  |
| `POST` | `/safety/ratings`    | Bearer | Submit a post-ride rating with tags            |
| `POST` | `/safety/sos`        | Bearer | Trigger SOS alert during an active ride        |
| `POST` | `/safety/disputes`   | Bearer | Raise a dispute on a completed ride            |

### Users — `/users`

| Method  | Path        |  Auth | Description                        |
| ------- | ----------- | :---: | ---------------------------------- |
| `GET`   | `/users/me` |  User | Get own profile + stats            |
| `PATCH` | `/users/me` |  User | Update name / email / preferences  |

### Admin — `/admin`

All admin routes require a valid admin JWT (`role: 'admin'`).

| Method  | Path                                  | Description                                          |
| ------- | ------------------------------------- | ---------------------------------------------------- |
| `GET`   | `/admin/drivers`                      | Driver list with status filter + search              |
| `GET`   | `/admin/drivers/:id`                  | Driver detail with documents (presigned S3 URLs)     |
| `PATCH` | `/admin/drivers/:id/status`           | Approve / reject / suspend / ban                     |
| `POST`  | `/admin/drivers/:id/docs/:docId/approve` | Approve individual driver document                |
| `POST`  | `/admin/drivers/:id/docs/:docId/reject`  | Reject individual driver document with reason     |
| `GET`   | `/admin/vehicles/categories`          | Vehicle categories (CRUD)                            |
| `POST`  | `/admin/vehicles/categories`          | Create vehicle category                              |
| `GET`   | `/admin/geo/cities`                   | City list                                            |
| `POST`  | `/admin/geo/cities`                   | Create city                                          |
| `PATCH` | `/admin/geo/cities/:id`               | Update city config                                   |
| `GET`   | `/admin/pricing/rate-cards`           | All rate cards (current + historical)                |
| `POST`  | `/admin/pricing/rate-cards`           | Create new rate card version                         |
| `GET`   | `/admin/pricing/surge`                | Active surge events                                  |
| `POST`  | `/admin/pricing/surge`                | Create surge event                                   |
| `GET`   | `/admin/safety/sos`                   | SOS alerts with status filter                        |
| `PATCH` | `/admin/safety/sos/:id/acknowledge`   | Acknowledge active SOS alert                         |
| `PATCH` | `/admin/safety/sos/:id/resolve`       | Resolve or mark false alarm                          |
| `GET`   | `/admin/safety/disputes`              | Dispute list with status filter                      |
| `PATCH` | `/admin/safety/disputes/:id/assign`   | Assign dispute to self                               |
| `PATCH` | `/admin/safety/disputes/:id/resolve`  | Resolve dispute with outcome + notes                 |
| `GET`   | `/admin/rides`                        | Ride list with status filter + search + pagination   |
| `GET`   | `/admin/users`                        | User list with status filter + search                |
| `PATCH` | `/admin/users/:id/status`             | Suspend or reinstate user account                    |
| `GET`   | `/admin/payments`                     | Payment transactions                                 |

---

## Frontend Apps

### Admin Dashboard

Full ops portal at `apps/admin` — all pages wired to the backend.

| Page       | Status | Notes                                             |
| ---------- | :----: | ------------------------------------------------- |
| Overview   | ✅     | Live stat cards                                   |
| Drivers    | ✅     | List, detail slide-over, approve / reject / ban   |
| Vehicles   | ✅     | Categories, brands, models, fleet — 4 tabs        |
| Cities     | ✅     | Create, edit, toggle rental/return-cab per city   |
| Pricing    | ✅     | Rate cards + surge event management               |
| Disputes   | ✅     | Dispute lifecycle, outcome selection, notes       |
| SOS        | ✅     | Live active alerts, acknowledge, resolve          |
| Payments   | ✅     | Transaction log with filters                      |
| Users      | ✅     | User list, suspend / reinstate                    |
| Rides      | ✅     | Ride list with search, status filter, pagination  |
| Live Map   | 🔜     | Planned — M11                                     |
| Analytics  | 🔜     | Planned — M12                                     |

### Driver App

Mobile-first PWA at `apps/driver`:

- 3-step onboarding (personal info → vehicle → documents)
- Go Online / Go Offline with confirmation dialog
- Incoming ride request card with countdown timer
- Active ride navigation (pickup → drop) with map view
- Earnings overview + wallet
- Profile with sign-out confirmation

### User App

Mobile-first booking app at `apps/user`:

- Phone OTP login
- Ride booking with city/route selection and fare estimate
- Real-time ride tracking via Socket.IO
- Post-ride rating with tags
- Wallet balance + top-up
- Profile editing + sign-out confirmation

---

## Testing

```bash
# Run all tests
pnpm test:api

# Watch mode during development
cd api && pnpm test:watch

# With coverage report
cd api && pnpm test:coverage
```

Tests run against a **dedicated test database** on port `5433` — production data is never touched. Each file manages its own lifecycle with `beforeAll` / `afterAll` cleanup.

```
Test Files   5 passed | 9 skipped (14)
     Tests  38 passed | 60 todo (98)
  Duration  ~4s
```

File uploads are mocked via `vi.mock('@/lib/storage')` so tests run without S3 or MinIO. Everything else hits real Postgres and Redis — no in-memory substitutes that hide integration bugs.

---

## Database

### Migrations

Migrations live in `api/src/db/migrations/` and run in filename order via a plain TypeScript runner — no migration framework required.

```bash
pnpm migrate            # apply pending
pnpm migrate --fresh    # drop everything and reapply (dev only)
```

### Schema Highlights

- **`drivers`** — `onboarding_step` column drives the resume flow; step advancement is done with a `CASE` expression so concurrent requests can't skip steps
- **`driver_vehicles`** — `UNIQUE INDEX ... WHERE is_primary = true AND status != 'blacklisted'` enforces exactly one active primary vehicle without application-layer logic
- **`driver_documents` / `driver_vehicle_documents`** — `ON CONFLICT (driver_id, doc_type) DO UPDATE` for idempotent re-uploads
- **`gps_tracks`** — monthly range partitioning; `DROP TABLE` for instant data retention vs slow `DELETE`
- **`refresh_tokens`** — only SHA-256 hashes stored; bare token is never written to disk
- **`fare_snapshots`** — immutable fare snapshot stored at booking time; rate card changes never affect in-flight rides
- **`wallet_ledger`** — double-entry ledger for driver and user wallets; balance is always derived, never stored
- **Triggers** — `set_updated_at()` PL/pgSQL function auto-applied to all tables with `updated_at`

---

## Environment Variables

Full reference for `api/.env`:

```env
# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/ocar
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10

# ── Redis ─────────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── JWT  (required — generate with: openssl rand -hex 32) ────────────────────
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY_USER=30d
JWT_REFRESH_EXPIRY_ADMIN=24h

# ── Razorpay  (required for M08) ─────────────────────────────────────────────
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# ── SMS providers  (required for M10) ────────────────────────────────────────
MSG91_AUTH_KEY=
MSG91_SENDER_ID=
FAST2SMS_API_KEY=

# ── Storage — S3 in production, MinIO in development ─────────────────────────
S3_BUCKET_NAME=
S3_REGION=ap-south-1
S3_ACCESS_KEY=
S3_SECRET_KEY=
MINIO_ENDPOINT=http://localhost:9000

# ── App ───────────────────────────────────────────────────────────────────────
NODE_ENV=development
API_PORT=4000
API_BASE_URL=http://localhost:4000
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002

# ── Workers ───────────────────────────────────────────────────────────────────
BULLMQ_CONCURRENCY=5

# ── Test ──────────────────────────────────────────────────────────────────────
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ocar_test
```

All variables are validated at startup with Zod — the server won't start if a required variable is missing or malformed.

---

## Security

- JWT access tokens expire in **15 minutes**; refresh tokens are **30-day** rolling with rotation on every use
- Refresh token bare values are **never stored** — only SHA-256 hashes. A leaked DB row gives an attacker nothing
- OTP brute force protection: **3 attempts → 15-minute lockout**; requesting a new OTP during lockout is also blocked
- Rate limiting on OTP requests: **3 per 15-minute window** per phone number
- File uploads capped at **5 MB** — oversized uploads return `FILE_TOO_LARGE` before the file is written anywhere
- `error.message` is **never exposed** in production responses
- Helmet sets security headers on every response; CORS is locked to the `ALLOWED_ORIGINS` list
- Razorpay webhooks verified with HMAC-SHA256 signature before processing

---

## Background Jobs

Six BullMQ workers run alongside the API:

| Worker          | Responsibility                                                |
| --------------- | ------------------------------------------------------------- |
| `notifications` | Send SMS / push / WhatsApp / voice on queue events            |
| `gps-flush`     | Batch-write GPS points from Redis → Postgres every 30s        |
| `settlements`   | Process driver payout settlements to bank accounts            |
| `analytics`     | Generate hourly / daily snapshot aggregates                   |
| `scheduler`     | Pre-create monthly table partitions on the 25th of each month |
| `cleanup`       | Expire stale OTP requests, revoked tokens, old audit rows     |

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Follow the module pattern — every feature goes into `api/src/modules/<name>/`
4. Write integration tests under `api/tests/integration/`
5. Ensure `pnpm test` passes with zero failures before opening a PR
6. Keep commits atomic and descriptive

---

## License

MIT © [Sujal Kr Ghosh](https://github.com/sujalkrghosh)

---

<div align="center">

Built with care · Designed for scale · Made to ship.

</div>
