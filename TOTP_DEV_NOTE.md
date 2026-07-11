# ⚠️ TOTP mandatory-enrollment gate is HARD-DISABLED right now

**File:** `api/src/middleware/auth.middleware.ts`
**Line:** the `mustEnrollTotp` assignment inside `authenticate()`

```ts
// TODO(SHIP-BLOCKER): hardcoded bypass, see TOTP_DEV_NOTE.md — remove before shipping
const mustEnrollTotp = false && MANDATORY_TOTP_ROLES.has(admin.role) && !admin.totp_enabled
```

This makes `mustEnrollTotp` always `false` — **no env var involved**, so it
is active in every environment this code runs in, including prod if
deployed as-is. `super_admin` / `finance_admin` accounts can call every API
route without ever enrolling in TOTP.

## Before shipping / before any deploy that isn't your local machine

Revert to:

```ts
const mustEnrollTotp = MANDATORY_TOTP_ROLES.has(admin.role) && !admin.totp_enabled
```

(Delete the `false &&` and the TODO comment.)

## Why this exists

Added 2026-07-11 as a "need it real quick" unblock for local dev — TOTP
enrollment was blocking all admin API calls for `super_admin`. Do not copy
this pattern elsewhere; it was intentionally reverted twice earlier the
same day before being hardcoded like this on explicit request.
