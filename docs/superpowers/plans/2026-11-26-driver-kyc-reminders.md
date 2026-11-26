# Driver onboarding reminders Implementation Plan

> **For agentic workers:** implement task by task; steps use checkbox syntax.

**Goal:** Remind drivers who stall in KYC (day 1/4/8), then pause (never delete), with admin settings and a delivery report.

**Architecture:** One send-log table, one pure `nextReminder` rule, one hourly sweep through the existing scheduler and `notifyOwner`, settings as `system_config` rows, wording as notification templates, one admin report page. No SMS.

**Tech Stack:** Express + pg + BullMQ (api), Next.js (admin), Expo (driver app), vitest.

**Spec:** `docs/superpowers/specs/2026-11-26-driver-kyc-reminders-design.md`

## Global Constraints
- Candidates: `drivers.status = 'pending_docs'` only. "Last progress" = `drivers.updated_at`. Never write to `drivers` from the reminder code.
- Send window 10:00 to 21:00 India time, at most one reminder per driver per day, defaults off (`kyc_reminders_enabled = 'false'`).
- Days default 1, 4, 8, pause day 10; each bounded 1..30; day_1 < day_2 < day_3 < pause_day.
- Paused = message stops, data kept. No deletion code anywhere.
- No SMS. No `error.message` in responses. Migration number is the next free one (165).

## Review Focus
- Sweep runs twice in the same hour: exactly one message (insert guard).
- Driver progresses between sweeps: no stale reminder; sequence restarts from the new progress time.
- Driver with no device token: still gets the in-app item, report says "No device registered".
- Admin disables the switch mid-sequence: nothing more is sent, nothing is lost.
- A driver whose `onboarding_step` is unknown: skipped, not sent a broken message.

## Files
- Create `api/src/db/migrations/165_driver_kyc_reminders.sql`: table, 5 config rows, 6 push templates.
- Create `api/src/modules/drivers/kyc-reminders.rules.ts` (+ `.test.ts`): `nextReminder`.
- Create `api/src/modules/drivers/kyc-reminders.service.ts` (+ DB test): `sendKycReminders`, `listKycReminderReport`.
- Create `api/src/modules/admin/kyc-reminders.routes.ts`; mount in `api/src/app.ts`.
- Modify `notifications.registry.ts` (type `kyc_reminder`), `scheduler.worker.ts` and `server.ts` (hourly job), `system-config-bounds.ts`, `broadcast.service.ts` (audience + link).
- Modify admin: `lib/system-config-model.ts`, `AdminSidebar.tsx`; create `app/(dashboard)/drivers/onboarding/page.tsx` + `lib/kyc-reminders-api.ts`.
- Modify driver app: `src/app/index.tsx`, `src/app/permissions.tsx`, `features/permissions/permissionSetup.ts`, `features/notifications/pushRouting.ts`.

### Task 1: Rule and storage
**Interfaces:** Produces `nextReminder(input: { now: Date; lastProgressAt: Date; sentSinceProgress: number; enabled: boolean; days: [number, number, number]; pauseDay: number }): 1 | 2 | 3 | null`.
- [ ] Write `kyc-reminders.rules.test.ts`: day 0 → null; at day 1 with 0 sent → 1; at day 5 with 0 sent → 1 (one message, never a burst); at day 5 with 1 sent → 2; at day 9 with 2 sent → 3; at day 9 with 3 sent → null; at day 10 → null (paused); `enabled:false` → null.
- [ ] Run, see fail. Implement the function. Run, see pass.
- [ ] Migration 165: `driver_kyc_reminder_sends(id, driver_id → drivers ON DELETE CASCADE, n SMALLINT 1..3, step TEXT, notification_id TEXT, sent_at)`, index `(driver_id, sent_at)`; five `system_config` rows (types: switch → `boolean`, numbers → `number`); six push templates `kyc_reminder_1..3` and `kyc_reminder_1..3_new` using `{{headline}}`, `{{nextStep}}`, `{{pauseDate}}`.
- [ ] Run `pnpm migrate` against the scratch DB; expect it to apply. Commit.

### Task 2: Sweep
**Interfaces:** Consumes `nextReminder`. Produces `sendKycReminders(now?: Date): Promise<number>` (messages sent), `listKycReminderReport(filter): Promise<ReportRow[]>`.
- [ ] DB test (scratch Postgres): seeded stalled driver at day 1 → one send, row in `driver_kyc_reminder_sends`, second call sends none; driver updated after send → none until its next day; disabled → none; outside 10:00 to 21:00 IST → none; driver with `pending_approval` → none.
- [ ] Implement in `kyc-reminders.service.ts`: read config rows, select candidates (`status='pending_docs'`), per driver count sends with `sent_at > updated_at`, call `nextReminder`, claim with an insert guarded by a unique-per-day check, then `notifyOwner({ type: 'kyc_reminder', ... })` with the rendered template and `payload.path` unused; store `notification_id`.
- [ ] Add `kyc_reminder` to the registry (General channel, 2 day TTL, collapse `type`); add `sweep_kyc_reminders` to `scheduler.worker.ts` and an hourly repeat in `server.ts`. Run tests; commit.

### Task 3: Settings
- [ ] Add bounds for the four day keys (1..30) in `system-config-bounds.ts` and the ordering check where bounds are validated; add the five rows and a "Driver onboarding" group to `system-config-model.ts`. Admin unit test for the model: the five keys land in the new group. Commit.

### Task 4: Report
**Interfaces:** Produces `GET /api/v1/admin/driver-onboarding/reminders?state=&result=&step=` (super_admin, ops_admin) returning rows `{ driverId, name, phone, step, lastProgressAt, sends: [{ n, sentAt, result }], state }`.
- [ ] Service test: results map as follows: `provider_response.successCount > 0` → `reached`; no `provider_response` and no `failure_reason` → `no_device`; `invalidTokens > 0 && successCount = 0` → `blocked`; `failure_reason` set → `problem`. State: `came_back` when `updated_at` is after the last send, `paused` past the pause day, `reminded`, `not_due`.
- [ ] Implement `listKycReminderReport` and the route; mount in `app.ts`. Run tests; commit.
- [ ] Admin page `drivers/onboarding`: counts strip, filters, table, status chip per result; sidebar entry under Verifications. Component test renders each result and state. Commit.

### Task 5: Reachability and tap
- [ ] Driver app: `/permissions?only=notifications` shows only the notifications row; `index.tsx` runs the gate for an onboarding driver with that mode. Test the row filter in `permissionSetup.test.ts`. Commit.
- [ ] `pushRouting.ts`: `kyc_reminder` → `'/'`; test in `pushRouting.test.ts`. Commit.

### Task 6: Backlog blast
- [ ] `broadcast.service.ts`: audience `incompleteKyc` (drivers with `status='pending_docs'`, driver-only like the other driver filters) and link key `onboarding`; admin `broadcasts/audience.ts` checkbox. Tests: schema accepts it for drivers and rejects it for riders. Commit.

### Task 7: Banners
- [ ] Four 2:1 PNGs from the approved design (0 to 3 steps done) saved for hosting; the send step attaches `imageUrl` only when a public base URL is configured. Verify a real push shows the picture on the phone.
