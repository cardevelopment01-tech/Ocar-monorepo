# Admin Onboarding & RBAC: Implementation Plan

> Drafted July 2026. Scope: replace direct-insert admin creation with invite-token onboarding,
> add fine-grained permissions on top of the existing `admin_role` enum, add an admin action
> audit log, and add an email delivery channel (needed for invites). Every decision below was
> made against real research (Uber Charter/ABAC, Airbnb Himeji/ReBAC, Retool RBAC, WorkOS Audit
> Logs, devise_invitable invite pattern) and against this repo's existing conventions —
> see "Decisions" for the reasoning, not just the conclusion.

---

## 0. Why this module exists

The current `admins` table (`api/src/db/migrations/003_m1_auth.sql`) has a 4-value `admin_role`
enum (`super_admin | ops_admin | support_admin | finance_admin`) but:
- No onboarding flow — admin rows are apparently inserted directly, no invite/expiry/audit trail
  of who created whom beyond the informal `created_by` self-ref.
- No fine-grained permissions — a role is all-or-nothing; you can't grant one support_admin
  audit-log access without a schema change.
- No dedicated admin action audit log — `driver_status_history` covers driver status transitions
  only, nothing for admins acting on any other table (payments, pricing, users, disputes...).
- No email transport — `notif_channel` only has `sms | push | in_app`; invite emails need a new
  channel.

## 1. Decisions (resolved, not open questions)

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | When is the `admins` row created — at invite time or at acceptance? | **At acceptance.** `admin_invites` holds all pending state; the `admins` row never exists half-formed. | Avoids a nullable-`password_hash` / `admin_status='invited'` state that's redundant with `admin_invites.status`. `admin_status` enum is just `active \| suspended`. |
| 2 | RBAC model: enum-only, enum+permissions join, or full ABAC? | **Role enum + `permissions`/`role_permissions` join.** | Uber-style ABAC (Charter/CEL) is over-engineering for a 3-city single-region platform. Plain enum can't grant narrow overrides. This is the Retool pattern — the closest analog (internal ops tool, not a multi-tenant marketplace). |
| 3 | `super_admin` enforcement — code bypass or fully seeded rows? | **Both.** `authorize()` short-circuits `role === 'super_admin' → true` (a missing/corrupt seed row can never lock out the top role), but every permission is still seeded for `super_admin` so the table stays truthful to read/audit. | Belt-and-suspenders; seed table is not a single point of failure. |
| 4 | City-scoping (`admin_city_scopes`) — build now or defer? | **Defer.** No column/table added anywhere in this migration. | 3 adjacent cities, single central ops team — no admin needs restricting today. Schema stays forward-compatible; a junction table drops in cleanly later. |
| 5 | Audit-log write path — generic middleware/trigger capture, or explicit service-layer call? | **Explicit `auditLog.record()` call at each mutation site**, persisted async via BullMQ. | A DB trigger can't know the acting admin without deliberate `SET LOCAL` session-context wiring — and once you're doing that you've already paid the app-layer cost, so call the service directly where before/after values and `req.admin.id` are already in scope. Matches the existing `notifyOwner()` pattern (build sync, enqueue the write). |
| 6 | `before_state`/`after_state` — full row snapshot or diff-only? | **Full row snapshot** (JSONB). | Simplest, no diff-computation code; diffing can happen at read-time in the admin UI if ever needed. |
| 7 | Invite expiry window | **48 hours.** | Confirmed. |
| 8 | Email service for invite delivery | **AWS SES**, new `email` value on `notif_channel` enum. | Reuses the AWS SDK/IAM credential chain already used for S3 — no new vendor key. Cheapest at low transactional volume. Plugs directly into the existing `notification_templates` render engine (`api/src/modules/notifications/templates.service.ts`) — just a new channel value, no new template abstraction. |
| 9 | Audit log retention/partitioning | **Unbounded for now, no partitioning.** | Acceptable at current write volume; revisit if it becomes a real row-count problem. |

## 2. Schema (final)

### `admins` diff
```
ADD COLUMN deleted_at   timestamptz NULL   -- soft delete, matches every other principal table
ADD COLUMN admin_status admin_status NOT NULL DEFAULT 'active'
```
```sql
CREATE TYPE admin_status AS ENUM ('active', 'suspended');
```

### `admin_invites` (new)
Token-based onboarding. Raw token emailed once, only its SHA-256 hash stored (mirrors
`refresh_tokens`). `admins` row is created only on redemption.
```
id, email, role (admin_role), token_hash (unique), invited_by -> admins.id,
status (invite_status: pending|accepted|expired|revoked), expires_at (48h from creation),
accepted_at, accepted_admin_id -> admins.id (null until redeemed),
created_at, updated_at (set_updated_at() trigger)
```
Indexes: unique on `token_hash` (redemption hot path), `(email, status)` (block duplicate
pending invites), `(status, expires_at)` (expiry sweep job).

### `admin_audit_log` (new)
Immutable, append-only. No `updated_at`/trigger.
```
id, admin_id -> admins.id (NULL = system-generated, matches driver_status_history.changed_by),
action varchar(80), target_table varchar(60), target_id bigint,
before_state jsonb, after_state jsonb, ip_address varchar(45), created_at
```
Indexes: `(admin_id, created_at desc)`, `(target_table, target_id, created_at desc)`,
`(created_at desc)`.

### `permissions` + `role_permissions` (new)
```
permissions:      id, slug (unique, e.g. drivers.approve), description, created_at
role_permissions: role (admin_role), permission_id -> permissions.id, created_at
                  PK (role, permission_id)
```
Seeded matrix across ~18 slugs × 4 roles (drivers.*, payments.*, pricing.manage, admins.invite,
admins.manage, notification_templates.manage, etc. — full list drafted in the migration itself).

### `notif_channel` enum extension
```sql
ALTER TYPE notif_channel ADD VALUE 'email';
```
Must run as its own statement/migration step — Postgres won't let a new enum value be used in
the same transaction that adds it.

### TableGroup
New `admin_rbac` group: `admin_invites`, `admin_audit_log`, `permissions`, `role_permissions`.
`admins` itself stays in `auth_principals`.

## 3. Phases

Each phase is scoped to land and be reviewed independently — **stop after each one for review**,
don't chain them.

- [x] **Phase 1 — Migration: `admins` diff + `admin_status` enum.** (`037_admin_status.sql`)
      Add `deleted_at`, `admin_status`; backfill existing rows to `active`/`NULL`. Verified via
      `pnpm migrate` + `\d admins` — ran clean, existing rows correctly default to
      `admin_status='active'`, `deleted_at=NULL`.
- [x] **Phase 2 — Migration: `admin_invites` table.** (`038_admin_invites.sql`)
      Table + indexes + `set_updated_at()` trigger attach. No backend code yet.
      Self-review caught a redundant duplicate unique index (inline `UNIQUE` on `token_hash`
      plus an explicit `CREATE UNIQUE INDEX` on the same column) — fixed before commit, verified
      only one index remains.
- [x] **Phase 3 — Migration: `admin_audit_log` table.** (`039_admin_audit_log.sql`)
      Table + indexes. No backend code yet. Verified `admin_id` nullable, all 3 indexes present,
      no `updated_at`/trigger (append-only confirmed).
- [x] **Phase 4 — Migration: `permissions` + `role_permissions` + seed data.** (`040_admin_permissions.sql`)
      18 permission slugs seeded; verified `super_admin` holds all 18 (no gaps), and
      ops/support/finance counts (11/6/8) match the intended matrix.
- [x] **Phase 5 — Backend: `admin-invites` module.** (`api/src/modules/admin-invites/`)
      `POST /api/v1/admin/invites` (create), `GET /` (list), `PATCH /:id/revoke`,
      `POST /api/v1/admin/invites/redeem` (public, sets password + creates `admins` row).
      Gated with the **existing** `requireAdmin('super_admin')` — matches every other admin
      route in this codebase, no new middleware.

      **Bug caught and fixed during verification:** `app.ts` mounted `/admin` (which applies
      `authenticate()` to everything under it via `router.use()`) *before* `/admin/invites` —
      Express matches mount prefixes in registration order, so the public `/redeem` route was
      401ing before ever being reached. Fixed by registering `/admin/invites` first. Full
      lifecycle verified live against the dev DB: create → duplicate-guard (409) → list (no
      `token_hash` leak, confirmed via grep on the raw response) → revoke → double-revoke
      (404) → redeem with bad token (400) → redeem with real token (creates `admins` row,
      confirmed real login works with the invited role) → re-redeem same token (400, correctly
      rejected) → non-super_admin attempting invite creation (403).
- [ ] ~~Phase 6 — sitewide `authorize(resource, action)` middleware~~ **DESCOPED.**
      Found mid-implementation: this codebase already has a working, sitewide role-gate
      (`requireAdmin(...roles)` in `middleware/role.middleware.ts`), used on ~30 existing routes.
      A new permissions-table-backed middleware would be a second, parallel authorization
      system that nothing calls unless every existing route is retrofitted — out of scope here.
      `permissions`/`role_permissions` (Phase 4) stay as seeded reference data for a future,
      deliberate migration off `requireAdmin` — not built/wired in this pass.
- [x] **Phase 7 — Backend: `recordAuditLog()` + BullMQ queue wiring.** (`api/src/lib/audit-log.ts`,
      `api/src/jobs/workers/audit.worker.ts`, new `audit` queue in `jobs/queues/index.ts`)
      Wired into the driver approve/suspend mutation site (`admin.repository.ts
      updateDriverStatus`) as a proof of concept: full before/after row snapshot captured
      inside the existing transaction (via `SELECT ... FOR UPDATE` before, re-`SELECT` after),
      enqueued only after `COMMIT` succeeds. `req.ip` threaded controller → service → repository.

      Verified live: approving a driver produced exactly one `admin_audit_log` row with
      correct `admin_id`, `before_state.status`/`after_state.status`, and `ip_address`; a
      rejected (invalid-transition) request produced zero rows, confirming the audit write
      never fires on a request that never reached the mutation. Async persistence via the new
      `audit` BullMQ worker confirmed non-blocking (response returned before the row existed;
      row appeared within the worker's poll interval).
- [x] **Phase 8 — AWS SES email transport.** (`api/src/lib/email.ts`, `041_admin_invite_email_template.sql`)
      `notif_channel` already had an `'email'` value in the DB (added speculatively during M10,
      unused until now) — no enum migration needed, smaller than originally planned. Added
      `@aws-sdk/client-sesv2`, `SES_REGION`/`SES_FROM_EMAIL`/`ADMIN_APP_URL` config (reusing the
      existing S3 AWS credentials — same account), and a dev bypass (`SES_FROM_EMAIL` empty →
      console log) matching the existing `FAST2SMS_API_KEY` pattern in `providers/sms.provider.ts`.
      Worker handler added for `admin_invite_email` in `notifications.worker.ts`.

      **Bug caught and fixed:** the seeded template body used `\n` inside a plain `'...'` SQL
      string literal — Postgres does not interpret backslash-escapes there (needs `E'...'`),
      so real emails would have shown literal `\n` characters. Caught by actually reading the
      rendered output, not just the SQL. Fixed by using real newlines in the string literal
      (both the migration file and the already-applied row).
- [x] **Phase 9 — Wire invite flow end-to-end.**
      Verified live: create invite → job queued → worker renders `admin_invite`/`email`
      template with `redeemUrl` (built from `ADMIN_APP_URL` + raw token) and `expiresAt` →
      dev-bypass logs the fully rendered, correctly-formatted email. Full loop already
      verified back in Phase 5 (redeem → real `admins` row → real login).

- [x] **Phase 10 — Frontend: `/admins` dashboard page** (`apps/admin/app/(dashboard)/admins/page.tsx`, `super_admin`-gated in the nav).
      Admin accounts table + invites table (both via the existing `DataTable`/`StatusPill` components),
      "Invite Admin" `SlideOver` form, revoke via `ConfirmDialog`. Required a small new backend
      endpoint not in the original plan: `GET /api/v1/admin/admins` (list admin accounts) — added
      to the existing `admin` module, matching its conventions exactly, since there was no way to
      show the admin roster otherwise. Graceful 403 state if a non-super_admin somehow lands here
      directly (backend is the real enforcement; nav already hides the link).
- [x] **Phase 11 — Frontend: `/accept-invite` page** (`apps/admin/app/(auth)/accept-invite/page.tsx`).
      Public, reuses the login page's two-panel branded layout. Token from the URL query param,
      set-password form, redirects to `/login?invited=1` on success (login page shows a success
      banner). No new visual language introduced — reuses `SlideOver`/pill/button conventions
      already established by the notification-templates and login pages.

      Verified: full production build (`next build`) succeeded with both new routes prerendering
      alongside all 21 existing routes, 0 errors; `tsc --noEmit` clean; dev server serves both
      pages at HTTP 200. **Not verified:** actual pixel-level rendering — no browser/screenshot
      tool is available in this environment, so visual QA (spacing, alignment, responsive
      behavior) has not been done. This is a real gap, not a "looks fine" claim.

- [x] **Phase 12 — Fix: verify invite token before rendering the accept-invite form.**
      Found via user testing: an expired/invalid link opened the password form and only failed
      on submit. Added `GET /api/v1/admin/invites/verify` (read-only, never mutates status) and
      an on-load check in the accept-invite page. Verified live: valid token → 200, garbage
      token → 400, and a token force-expired directly in the DB → 400 with status still
      `pending` (confirming the read-only check never mutates, unlike `redeemInvite`).

- [x] **Phase 13 — Fix: 5 admin mutation routes had no role restriction at all.**
      Found via user testing (after creating real non-super_admin accounts for the first time):
      `PATCH /drivers/:id/status`, `PATCH /users/:id/status`, `GET /payments`,
      `PATCH /safety/sos/:id/{acknowledge,resolve}`, `PATCH /safety/disputes/:id/{assign,resolve}`
      had `authenticate()` only — any authenticated admin, any role, could call them. Added
      `requireAdmin(...)` matching the seeded `role_permissions` matrix. Verified live:
      cross-role tests (finance_admin blocked from driver-approve, ops_admin blocked from
      payments, and the correct role succeeding in each case).

      Research (Uber/AWS/DRF/SOC2 patterns) confirmed "reads open, mutations gated" is only
      acceptable as an *explicit, enforced* rule — the actual prevention mechanism industry uses
      is structural (a lint rule or CI contract test asserting every route declares an auth
      requirement), not manual vigilance. Not built here — see non-goals.

- [x] **Phase 14 — Audit log tamper-evidence + admin suspend/reactivate flow.**
      Research (AWS root-account model, SOC2/SIEM practice) confirmed an audit log is only
      trustworthy if even the highest-privilege account can't alter it. A plain
      `REVOKE UPDATE, DELETE` would have been a no-op — **the app connects as the `postgres`
      superuser**, which bypasses all grant checks. Fixed with a `BEFORE UPDATE OR DELETE`
      trigger on `admin_audit_log` that unconditionally raises an exception — triggers fire
      regardless of role, unlike GRANT/REVOKE. Verified live: both UPDATE and DELETE rejected
      even from the superuser connection itself.

      Separately found: `admin_status` (Phase 1) was dead data — no endpoint ever changed it,
      and neither login nor `authenticate()` checked it (only the pre-existing `is_active` did).
      Added `PATCH /api/v1/admin/admins/:id/status` (`super_admin` only, self-suspend blocked,
      audited) which updates `admin_status` and `is_active` together rather than rewiring the
      existing auth checks. Verified live: suspending an admin blocks their next login, **and**
      revokes an already-issued access token on its very next request (confirmed
      `authenticate()` re-checks `is_active` from the DB every request, not just at login) —
      reactivating restores access immediately. Also added a super_admin-only Audit Log page
      (`apps/admin/app/(dashboard)/audit-log/`) — actor, action, target, before/after diff, IP,
      timestamp, paginated.

- [x] **Phase 15 — TOTP/2FA enrollment + enforcement.**
      Research (GitHub/Supabase enrollment UX, AWS root-MFA tiering-by-privilege, RFC 6238)
      → plan → build, all in one pass. New `admin-totp` module: `otplib` (generate/verify) +
      `qrcode` (QR rendering), secret encrypted at rest (AES-256-GCM, new `lib/totp-crypto.ts`,
      new `TOTP_ENCRYPTION_KEY` env var — not marked enabled until one real code is confirmed,
      catching setup mistakes at enrollment rather than first login). 8 recovery codes generated
      on confirm, hashed with bcrypt like passwords, single-use (`admin_recovery_codes` table).

      **Two-step login**, matching the GitHub/Supabase/AWS pattern: password succeeds → if
      `totp_enabled`, a short-lived pending-verify token is issued instead of real tokens (new
      `signPendingTotpToken`/`verifyPendingTotpToken` in `lib/jwt.ts`, deliberately shaped
      nothing like a real access token — no `role` claim, so it can never pass
      `authenticate()`'s role check even if misused) → `POST /api/v1/auth/admin/totp-verify`
      accepts a TOTP code or a recovery code → only then issues real tokens.

      **Enforcement, tiered by privilege** (AWS root/privileged-user precedent, not applied
      uniformly): mandatory for `super_admin`/`finance_admin`, optional-but-available for
      `ops_admin`/`support_admin`. `authenticate()` blocks a mandatory-role admin without
      `totp_enabled` from every route except `/admin/totp/*` and `/auth/logout` — no grace
      period, since this platform is pre-launch with no real user base yet to protect against
      a surprise lockout (AWS's 35-day grace window exists for exactly that problem, which
      doesn't apply here).

      **Two bugs caught by live testing, not just reading the code:**
      1. otplib's `verify()` *throws* for a non-6-digit token (e.g. a recovery code like
         `MYF8-XNW8`) instead of returning `{ valid: false }` — crashed before ever reaching
         the recovery-code fallback. Fixed by guarding the TOTP path to only run on input
         shaped like `/^\d{6}$/`.
      2. Self-review caught RFC 6238's replay-window recommendation was missing entirely — a
         captured valid code could be replayed within its own ~30-90s validity window. Added
         `totp_last_timestep` (new column) + otplib's native `afterTimeStep` option; verified
         live that the identical code succeeds once and is rejected on a second attempt via a
         fresh pending token.

      Also added, found missing during self-review: `admin_totp.enabled`/`admin_totp.disabled`
      audit log entries (this module's own audit-log pattern wasn't being applied to itself).

      Verified live end-to-end: mandatory-role gate (super_admin blocked from every route
      except `/admin/totp/*` until enrolled, confirmed via the real seed account), voluntary
      enrollment for a non-mandatory role (never blocked either way), full enroll → real
      login-verify → recovery-code login → replay rejection → disable cycle, and disabling a
      mandatory role's 2FA correctly re-triggers the enrollment gate. 74/74 unit tests pass
      (10 new: crypto round-trip/tamper/malformed, recovery-code format/entropy, otplib
      generate/verify/epoch-tolerance/replay-guard). Frontend: `/security` page (all roles,
      QR enrollment, recovery codes shown once, disable-with-password) + login page's two-step
      verify UI + axios interceptor redirect on `TOTP_SETUP_REQUIRED`.

      **Left the real seed `admin@ocar.com` account with TOTP disabled** after testing — the
      secret generated during testing was never shown to a real authenticator app, so leaving
      it enabled would have locked the actual user out on next login.

## 4. Non-goals (explicitly out of scope for this plan)

- City-scoped admin access (§1 decision 4)
- Per-admin permission overrides beyond role-level grants
- Audit log retention/partitioning/archival
- IP allowlisting for admin login — flagged again by Phase 13/14/15 research, still deferred
- Admin session timeout changes (separate from this plan — a product decision, not schema)
- CI contract-test asserting every route has an explicit auth check (Phase 13 finding — the
  actual structural fix to prevent this bug class recurring; real, not built, could be a
  follow-up)
- Dual-control/four-eyes approval for destructive super_admin actions (Phase 14 research —
  banking/PAM-grade pattern, no current need at this platform's scale)
- Real-time alerting on sensitive admin actions beyond the audit log itself (Phase 14 research)
- SMS as a TOTP recovery fallback — Phase 15 research is unanimous SMS is the weaker, phishable
  factor; recovery codes are the only backup path, deliberately
