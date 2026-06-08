<div align="center">

<br />

<h1>🚖 Ocar</h1>

<p><strong>A production-grade, full-stack cab booking platform — built for scale, designed for India.</strong><br />
End-to-end ride management: driver onboarding · real-time GPS · fare engine · payments · analytics.</p>

<br />

[![Node.js](https://img.shields.io/badge/Node.js-22_LTS-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x_strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Express](https://img.shields.io/badge/Express-4.18-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL_16-PostGIS_3.4-4169E1?style=flat-square&logo=postgresql&logoColor=white)](https://postgresql.org)
[![Redis](https://img.shields.io/badge/Redis-7_Alpine-DC382D?style=flat-square&logo=redis&logoColor=white)](https://redis.io)
[![pnpm](https://img.shields.io/badge/pnpm-9+-F69220?style=flat-square&logo=pnpm&logoColor=white)](https://pnpm.io)

[![Tests](https://img.shields.io/badge/tests-38_passing-22C55E?style=flat-square&logo=vitest&logoColor=white)](#-testing)
[![Modules](https://img.shields.io/badge/modules-12_planned-8B5CF6?style=flat-square)](#-module-roadmap)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=flat-square&logo=docker&logoColor=white)](./docker-compose.yml)
[![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-EF4444?style=flat-square&logo=turborepo&logoColor=white)](https://turbo.build)
[![License](https://img.shields.io/badge/license-MIT-64748B?style=flat-square)](./LICENSE)

<br />

[**Quick Start**](#-quick-start) &nbsp;·&nbsp; [**Architecture**](#-architecture) &nbsp;·&nbsp; [**API Modules**](#-api-modules) &nbsp;·&nbsp; [**Testing**](#-testing) &nbsp;·&nbsp; [**Roadmap**](#-module-roadmap)

<br />

</div>

---

## What is Ocar?

Ocar is a **12-module monorepo** powering a full cab booking ecosystem - think Ola or Uber, but built from the ground up with modern tooling and a clean architecture you can actually understand and extend.

It covers the complete lifecycle: a driver registers, gets approved, goes online, receives ride broadcasts, completes trips, earns money, and the platform handles every edge case along the way - OTP verification, geospatial matching, dynamic fare calculation, Razorpay payments, wallet settlements, SOS alerts, dispute resolution, and admin oversight.

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
- **Multi-channel notifications** — SMS (MSG91 / Fast2SMS), push (FCM), WhatsApp, voice calls
- **Safety layer** — SOS with severity levels, ride ratings with tagged feedback, dispute lifecycle with evidence uploads
- **Full audit trail** — every sensitive action stamped with actor, IP, and timestamp
- **Three frontend apps** — user booking app (Next.js), driver app (Vite + React), admin dashboard (Next.js)

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
│      PostgreSQL 16          Redis 7              BullMQ          │
│       + PostGIS 3.4        (cache / OTP)       (job queues)      │
│         :5432 / :5433           :6379          Workers ×6        │
│                                                                   │
│                     S3 / MinIO — file storage                    │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision       | Choice            | Why                                                                                             |
| -------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| ORM            | Raw `pg` Pool     | Zero abstraction overhead; full control over spatial queries and CTEs                           |
| Spatial        | PostGIS 3.4       | `geography` type gives accurate distance at Indian latitudes; partial indexes on active drivers |
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
| Database      | PostgreSQL 16 + PostGIS 3.4 |
| Cache / Queue | Redis 7 + BullMQ 5          |
| Auth          | JWT + OTP (phone-based)     |
| Payments      | Razorpay                    |
| Storage       | AWS S3 / MinIO              |
| Real-time     | Socket.IO                   |
| File uploads  | Multer (memoryStorage)      |
| Validation    | Zod 3                       |
| Testing       | Vitest 1 + Supertest        |

</td>
<td valign="top" width="50%">

**Frontend**

| App             | Technology                   |
| --------------- | ---------------------------- |
| User app        | Next.js 16, React 19         |
| Driver app      | Vite, React 19, React Router |
| Admin dashboard | Next.js 16, React 19         |
| Styling         | Tailwind CSS                 |
| State           | Zustand                      |
| Maps            | Leaflet                      |
| HTTP            | Axios                        |

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
│   │   │   └── migrations/       # 16 numbered SQL files
│   │   ├── lib/                  # Shared utilities
│   │   │   ├── jwt.ts            # Access + refresh token helpers
│   │   │   ├── otp.ts            # OTP generate / hash / lock / rate-limit
│   │   │   ├── hash.ts           # bcrypt + SHA-256
│   │   │   ├── errors.ts         # Typed HTTP error factory
│   │   │   ├── storage.ts        # S3 / MinIO upload + delete
│   │   │   ├── spatial.ts        # PostGIS query helpers
│   │   │   ├── fare.ts           # Fare calculation engine
│   │   │   └── pagination.ts     # Cursor + offset pagination
│   │   ├── middleware/           # Auth, role guard, validate, audit, rate-limit
│   │   ├── modules/              # Feature modules (12 total)
│   │   │   ├── auth/             # ✅ M02 — Phone OTP + admin login
│   │   │   ├── drivers/          # ✅ M03 — Driver onboarding flow
│   │   │   ├── vehicles/         # ✅ M03 — Vehicle catalogue lookup
│   │   │   ├── geo/              # 🔜 M05 — City zones + geocoding
│   │   │   ├── pricing/          # 🔜 M06 — Fare engine + surge
│   │   │   ├── rides/            # 🔜 M07 — Booking + broadcast
│   │   │   ├── payments/         # 🔜 M08 — Razorpay + wallet
│   │   │   ├── safety/           # 🔜 M09 — SOS + disputes + ratings
│   │   │   ├── notifications/    # 🔜 M10 — SMS / push / WhatsApp
│   │   │   ├── admin/            # 🔜 M11 — Ops dashboard API
│   │   │   └── analytics/        # 🔜 M12 — Snapshots + reports
│   │   ├── jobs/
│   │   │   ├── queues/           # BullMQ queue definitions
│   │   │   ├── workers/          # 6 worker processes
│   │   │   └── processors/       # Individual job handlers
│   │   └── websocket/            # Socket.IO handlers + rooms
│   └── tests/
│       ├── unit/                 # lib/fare, lib/pagination
│       └── integration/          # m01–m12 (38 passing, 60 todo)
│
├── apps/
│   ├── user/                     # Next.js booking app (port 3000)
│   ├── driver/                   # Vite driver app (port 3001)
│   └── admin/                    # Next.js admin dashboard (port 3002)
│
├── docs/
│   ├── decisions/                # Architecture Decision Records (ADRs)
│   ├── architecture/
│   └── api/
│
├── infra/docker/nginx/           # Nginx reverse proxy config
├── docker-compose.yml            # Postgres (×2) + Redis
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
cp .env.example .env
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
# Starts: PostgreSQL :5432, PostgreSQL test :5433, Redis :6379
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

| #   | Module            |   Status    |  Tests  | Description                                                |
| --- | ----------------- | :---------: | :-----: | ---------------------------------------------------------- |
| M01 | Foundation        | ✅ Complete |  8 / 8  | Health check, DB/Redis connectivity, request ID middleware |
| M02 | Auth & Identity   | ✅ Complete | 14 / 14 | Phone OTP login, admin email auth, JWT refresh rotation    |
| M03 | Driver Onboarding | ✅ Complete | 13 / 13 | Personal info, vehicle, document uploads, resume flow      |
| M04 | Vehicle Catalogue | ✅ Complete |    —    | Categories, brands, models — public lookup endpoints       |
| M05 | Geolocation       | 🔜 Planned  |  0 / 5  | City zones, geocoding cache, driver location tracking      |
| M06 | Pricing & Fare    | 🔜 Planned  |  0 / 7  | Base fare + per-km/min, surge scheduling, fare estimates   |
| M07 | Ride Management   | 🔜 Planned  | 0 / 11  | Booking, driver broadcast, OTP verification, GPS tracking  |
| M08 | Payments          | 🔜 Planned  |  0 / 8  | Razorpay orders, webhooks, wallet, driver settlements      |
| M09 | Safety            | 🔜 Planned  |  0 / 8  | SOS alerts, ride ratings, dispute lifecycle, warnings      |
| M10 | Notifications     | 🔜 Planned  |  0 / 5  | SMS, push, WhatsApp, voice — multi-channel delivery        |
| M11 | Admin Panel       | 🔜 Planned  |  0 / 6  | Driver approval, config management, ops oversight          |
| M12 | Analytics         | 🔜 Planned  |  0 / 5  | Revenue snapshots, ride stats, driver performance          |

> **38 of 98 tests active** — remaining 60 are `todo` placeholders unlocked as modules ship.

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

OTP is rate-limited to **3 requests per 15-minute window**. Three wrong attempts locks verification for 15 minutes; requesting a new OTP during a lockout is blocked server-side.

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

The onboarding step is persisted in the database — drivers can close the app and **resume exactly where they left off**. Step order is enforced server-side.

### Vehicles — `/vehicles`

| Method | Path                               | Auth | Description                   |
| ------ | ---------------------------------- | :--: | ----------------------------- |
| `GET`  | `/vehicles/categories`             |  —   | All active vehicle categories |
| `GET`  | `/vehicles/brands`                 |  —   | All active vehicle brands     |
| `GET`  | `/vehicles/brands/:brandId/models` |  —   | Models for a specific brand   |

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

- **`drivers`** — `onboarding_step` column drives the resume flow; step advancement is done with a `CASE` expression in the `UPDATE` so concurrent requests can't skip steps
- **`driver_vehicles`** — `UNIQUE INDEX ... WHERE is_primary = true AND status != 'blacklisted'` enforces exactly one active primary vehicle without application-layer logic
- **`driver_documents` / `driver_vehicle_documents`** — `ON CONFLICT (driver_id, doc_type) DO UPDATE` for idempotent re-uploads
- **`gps_tracks`** — monthly range partitioning; `DROP TABLE` for instant data retention vs slow `DELETE`
- **`refresh_tokens`** — only SHA-256 hashes stored; bare token is never written to disk
- **Triggers** — `set_updated_at()` PL/pgSQL function auto-applied to all tables with `updated_at`

---

## Environment Variables

Full reference for `api/.env`:

```env
# ── Database ─────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ocar
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

## Frontend Apps

| App           | Port | Stack                        | Purpose                                      |
| ------------- | ---- | ---------------------------- | -------------------------------------------- |
| `apps/user`   | 3000 | Next.js 16, React 19, Leaflet, Zustand | Booking, ride tracking, wallet, trip history |
| `apps/driver` | 3001 | Vite, React 19, React Router, Zustand  | Onboarding, active ride management, earnings |
| `apps/admin`  | 3002 | Next.js 16, React 19, Zustand          | Driver approval, config, disputes, analytics |

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
