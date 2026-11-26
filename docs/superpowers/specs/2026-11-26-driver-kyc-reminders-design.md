# Driver onboarding reminders (design)

Status: **approved and built** (see the plan in `docs/superpowers/plans/2026-11-26-driver-kyc-reminders.md`). Visual design (notification, banners, copy): https://claude.ai/artifact/JjAVduErkh7HsKQKEiD4v7

## Why
A driver installs the app, verifies a phone number, and stops partway through KYC (details, vehicle, documents, selfie). They never get to ride requests, and nothing in the product brings them back. The client wants a short, respectful reminder sequence for those drivers, and an admin view of who was reached and who was not.

## Goals
- A driver who has stalled in onboarding gets up to three reminders (day 1, 4, 8 after their last progress), each naming where they stopped and opening that step.
- After the third, the application is **paused, not deleted**: no more messages, data kept, they can resume by opening the app.
- Admins can switch it on and off, change the timing, and see per driver: where they stopped, what was sent, and whether it reached the device.
- Wording is editable by admins without a deploy.

## Non-goals
- **No SMS** in any phase. (Decided by the client; an SMS channel would also need an approved DLT template.)
- No deletion or purge job. Pausing only stops messages. A later purge of long-dead applications is a separate decision, because it removes stored documents.
- Drivers who installed but never verified a number: we hold no phone number or push token for them, so nothing can reach them. Out of scope.
- No per-driver "send now" button, no A/B testing, no new notification channel.

## Anti-goals (failure even if it works)
- Messages at night, or more than one a day to the same driver.
- A fake or invented deadline. The only date ever shown is the real pause date.
- Reminders to a driver who already moved forward, finished, or is waiting on admin review.

## Constraints found in the code
- Push needs a stored device token, and a token is only stored if notification permission was granted. Drivers in onboarding are never asked for it today (the new setup screen only runs on the way to Home). Without fixing that, the reminders reach almost nobody.
- `drivers.updated_at` moves on any driver update, so our own bookkeeping must **not** write to `drivers` or it would reset "last progress".
- `notifyOwner()` already persists an in-app item, queues the push, and records the push outcome on `notification_logs` (`provider_response`, `failure_reason`). That is the delivery evidence the report reads.
- Offers are only sent 10:00 to 21:00 India time (`offersAllowedNow`); the same window applies here.

## Approaches considered
1. **Reuse what exists (chosen).** One new table, one sweep job in the existing scheduler, existing `notifyOwner`, existing notification templates, existing System config page, one new admin report page. Smallest diff, nothing new to operate.
2. Admin sends manual broadcasts each week. Needs no code, but depends on a person remembering, cannot count days per driver, and cannot stop for drivers who progressed.
3. Third-party journey tool (CleverTap and similar). Strongest analytics, but a new vendor, new SDK in the app, and customer data leaving the platform for one reminder flow.

## Design

### Who is a candidate
`drivers.status = 'pending_docs'` (still in onboarding). Not `pending_approval` (waiting on admins), not `docs_rejected` (already has its own push), not suspended or banned. "Last progress" is `drivers.updated_at`.

### Which reminder is due (pure function, unit tested)
`nextReminder(now, lastProgressAt, sentSinceProgress, cfg)` returns `1 | 2 | 3 | null`:
- reminder k is due when `now >= lastProgressAt + day_k` and fewer than k reminders were sent since that progress; the earliest unsent due one is returned, so a late sweep sends one message, never a burst;
- returns `null` once `now >= lastProgressAt + pause_day` (paused), or when disabled.
Progress after a send makes older sends not count ("since progress"), so a driver who moves one step and stalls again gets a fresh sequence.

### Storage
One table, no state flags (paused and counts are derived):
```
driver_kyc_reminder_sends (
  id BIGSERIAL PK, driver_id BIGINT REFERENCES drivers ON DELETE CASCADE,
  n SMALLINT CHECK (n BETWEEN 1 AND 3), step TEXT NOT NULL,   -- onboarding_step at send time
  notification_id BIGINT,                                      -- links to notification_logs for the delivery result
  sent_at TIMESTAMPTZ DEFAULT now() )
```
Cascade delete means the existing account-deletion path leaves no personal data behind in it.

### Sweep
New `sweep_kyc_reminders` in the scheduler worker (hourly). Inside the India-time window and when enabled: select candidates, call `nextReminder`, claim the send with an insert (unique `(driver_id, n, sent_at::date)` style guard) so overlapping runs cannot double-send, then `notifyOwner({ type: 'kyc_reminder', ... })`. New type in `notifications.registry.ts` (General channel, 2-day TTL, collapse `type` so a new reminder replaces an old one on the device).

### Copy and image
Three editable notification templates (`kyc_reminder_1..3`, push channel, English; Hindi and Odia use the same locale mechanism if wanted), filled with `{done}`, `{next_step}`, `{pause_date}`. Pause date = last progress + `pause_day`. One banner image per progress step (0 to 3 steps done; four PNGs), no date or name inside the image. The PNGs live in `apps/user/public/push/` (regenerate with `scripts/make-kyc-banners.mjs`) and are served by the user web app. The folder's public https address is the admin setting `kyc_banner_base_url`; empty means reminders go out without a picture.

### Tap behaviour
New push type `kyc_reminder` opens the app root, which already resumes the saved onboarding step. Older installs that do not know the type open the app or notification centre, which still works.

### Make push reachable (driver app)
For a driver in onboarding, the setup screen asks for **notifications only** (not location) before the first step. The existing setup screen gets a `only=notifications` mode.

### Admin: settings
Six rows in the existing System config page, new group "Driver onboarding":
`kyc_reminders_enabled` (switch, **default off**), `kyc_reminder_day_1` (1), `kyc_reminder_day_2` (4), `kyc_reminder_day_3` (8), `kyc_pause_day` (10), `kyc_banner_base_url` (empty). Days are bounded 1 to 30 and day_1 < day_2 < day_3 < pause_day is enforced. The send window is fixed, not a setting.

### Admin: report ("Onboarding follow-up" page)
`GET /api/v1/admin/driver-onboarding/reminders` (super_admin and ops_admin) feeding a page next to Verifications. Top counts: stalled, reminded, came back, not reachable. Table per stalled driver:

| Column | Source |
|---|---|
| Driver (name, phone) | drivers |
| Stopped at | onboarding_step |
| Last progress | drivers.updated_at |
| Reminders | count of sends since progress, with each send's time |
| Result of last send | derived from `notification_logs` (below) |
| State | Not yet due, Reminded, Paused, Came back |

Result values, in plain words: **Reached the device** (FCM accepted it), **No device registered, in-app only** (no token, usually permission never granted), **Notification blocked** (token invalid), **Delivery problem** (FCM unavailable). "Came back" = progress after a send. Filters: state, stopped-at, result. Honest limit: FCM confirms acceptance, not that the driver saw it; the report says "reached the device", never "read".

### Backlog blast (the client's immediate ask)
Add an `incompleteKyc` audience filter and an `onboarding` link key to the existing admin broadcast, so the drivers who already stalled can be sent one announcement today, with the existing image, daily cap and opt-out handling.

## Build order, each with its check
1. Onboarding asks for notification permission (driver app). Check: a new login in onboarding sees the Allow dialog.
2. Migration + `nextReminder` + tests. Check: unit tests for day 1, 4, 8, progress resets, paused, disabled.
3. Sweep + registry type + templates. Check: scratch-database run with a seeded stalled driver sends exactly one message and is idempotent on a second run.
4. System config rows + bounds + admin labels. Check: change a value in the UI, the sweep honours it.
5. Report endpoint + page. Check: seeded drivers cover every result value and state.
6. Broadcast audience and link. Check: broadcast to the tester's own number.
7. Tap routing and banner images. Check: on a phone, tap opens the saved step.

## Open items
- Set `kyc_banner_base_url` once the user web app serving `apps/user/public/push/` is deployed (not set by this change).
- Pause day default (proposed 10).
- Languages beyond English.
- A later, separate decision: whether and when paused applications are purged.
