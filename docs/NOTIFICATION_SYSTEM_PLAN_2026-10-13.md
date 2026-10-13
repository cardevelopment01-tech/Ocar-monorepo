# Notification system: research, current state, and plan

Date: 2026-10-13. Scope: API notification module, `apps/driver-mobile`, `apps/rider-mobile`, `packages/mobile-shared`, admin portal.

How to read this: section 1 is the short version. Section 2 is what good systems look like (researched). Section 3 is what we have today, with evidence from the code. Section 4 is the target design. Section 5 is the phased plan. Section 6 lists decisions I need from you.

---

## 1. Summary

We have a working skeleton: a persisted in-app feed, FCM push, a socket live-update, editable templates, token pruning on invalid tokens, and a basic notifications screen in both apps. What we do not have is a *system*: there is no event registry, no per-event channel/priority/TTL, no user preferences, no delivery tracking, no foreground display, and no live unread badge. Several real bugs follow from that.

The five findings that matter most:

| # | Finding | Why it matters |
|---|---|---|
| N-1 | Android push TTL, collapse key and tag are never set. `ttlSeconds` and `tag` are only written into the `webpush` block (`push.provider.ts`). | A "New ride request" push meant to live 30 s uses FCM's default lifetime (up to 4 weeks), so a driver who reconnects later can get a stale request. Repeat pushes stack instead of collapsing. |
| N-2 | The rider gets pushes only for `ride_accepted`, `ride_completed`, `payment_failed`, `stop_unreachable`, and chat. Driver arrived, ride started, driver cancelled, and no drivers found go over the socket only. | A backgrounded rider misses the most time-sensitive events. This got worse with the performance work: the rider socket now disconnects in the background, so push is the only path. **This is a gap I should have caught when I made that change.** |
| N-3 | Neither app shows anything while in the foreground. No `setNotificationHandler`, no `onMessage` handler, and no listener for the server's `notification:new` socket event. The admin web portal has all three. | In-app, a notification is silent. A driver on the wrong screen sees nothing for a document rejection or wallet warning. |
| N-4 | The rider app has one Android channel (`default_v2`, default importance, no heads-up). The driver has two. | Rider "driver arrived" cannot pop up as a heads-up notification. Channels cannot be changed after creation, so the right set must be chosen once. |
| N-5 | The rider logout calls `unregisterPushNotifications(api, null)`, a no-op. The driver app had the same bug and was fixed earlier in this audit. | After rider logout the phone keeps receiving that rider's pushes until someone logs in on it and re-binds the token. |

The in-app notification screen exists but is thin: no unread badge on the bell, no live updates, no grouping, no icons by type, dead taps for unrouted types, no settings, and no way for the rider to reach it from Home.

---

## 2. How production notification systems are built (research)

Sources are listed at the end. Where a source was a secondary or vendor page I say so, and I mark claims I could not confirm from an official page.

### 2.1 The standard architecture

Every ride-hailing and delivery system I found separates five layers:

1. **Event producers.** Ride lifecycle, payments, documents, safety, admin actions. They emit a *business event*; they do not build push payloads.
2. **A notification service.** One entry point takes `(event, recipient, context)` and decides: which channels (push, in-app feed, SMS, socket), which template, whether the user's preferences allow it, whether it is a duplicate, and how urgent it is.
3. **A queue with workers.** Sends happen off the request path with retries and backoff, so a slow provider cannot slow a ride transition. (We already run BullMQ.)
4. **Providers.** FCM for push, an SMS gateway for OTP and critical fallbacks. Providers return per-recipient results that the service records.
5. **Clients.** Own the notification channels, the foreground display, tap routing, the notification center, and the settings screen.

Cross-cutting concerns the sources call out repeatedly: per-channel and per-category opt-outs, delivery tracking (sent, delivered, opened), de-duplication, per-user rate limits, and throttling promotional traffic first under load.

Two de-duplication layers are common: a Redis `SET NX` on a `dedup_key` before queueing (typically a 24-hour window) and idempotency keys on provider calls. We already use `SET NX` once, for the ride-request push.

### 2.2 FCM message design (official docs)

- **Notification vs data messages.** A *notification message* is displayed by the FCM SDK when the app is in the background; in the foreground it is delivered to an app callback and the app decides what to show. A *data message* always goes to app code. A message may carry both: the tray shows the notification part and the data part is handed to the app on tap. Payload limit is 4096 bytes.
- **Priority.** Notification messages default to high priority, data messages to normal. High priority is delivered immediately, including in Doze, and is meant for time-sensitive, user-visible content. Normal priority is recommended otherwise to save battery.
- **TTL.** On Android, TTL is how long FCM stores the message while the device is offline. A message that is no longer useful should have a short TTL. (A ride request is useful for about the dispatch window.)
- **Collapse key.** Only the latest message with the same key is delivered when the device returns. FCM allows at most 4 distinct collapse keys per device at a time.
- **Token hygiene.** Store a timestamp per token and refresh it regularly. On Android FCM expires registrations after 270 days of inactivity. Delete a token on `UNREGISTERED` (404) or `INVALID_ARGUMENT` (400, only if the payload is known valid). Prune tokens outside your own staleness window with a scheduled job. We already delete on those errors; we do not prune by age, and `last_seen_at` is only written when the app registers.
- **Quotas.** The default HTTP v1 quota is 600,000 messages per minute per project, counting messages not requests. Over quota returns 429. This is far above our scale, but a campaign should still be sent in batches (an Admin SDK multicast call is capped per request; I could not confirm the exact cap from an official page, so verify against the Admin SDK reference before building).

### 2.3 Android notification channels (official docs)

- On Android 8+, every notification must belong to a channel. A notification posted to a missing channel does not appear.
- **Importance and behavior cannot be changed by the app after creation**; only the name and description can. The user can change them in system settings at any time. Recreating a channel with its original values is a safe no-op.
- Importance levels: Urgent/`HIGH` (sound + heads-up), High/`DEFAULT` (sound), Medium/`LOW` (silent), Low/`MIN` (silent, no status bar icon).
- Guidance: one channel per *type* of notification that a user may reasonably want to treat differently, with names a user understands. Use channel groups when names would otherwise collide.
- **Android 13+ POST_NOTIFICATIONS** is a runtime permission. Google's guidance is to let users explore the app first, ask in context (for example after a user action), explain the benefit before the system dialog, and handle denial by pointing to settings. A channel must exist before the prompt can appear.

### 2.4 Foreground, background and tap handling (Expo and React Native Firebase)

- Expo shows nothing in the foreground unless `setNotificationHandler` returns a behavior (`shouldShowBanner`, `shouldShowList`, `shouldPlaySound`). If the handler does not answer within 3 seconds the notification is dropped. Setting `shouldPlaySound: false` on Android also suppresses the heads-up alert.
- React Native Firebase: `onMessage` fires only in the foreground; `setBackgroundMessageHandler` covers background and quit, and must be registered at module init. Data-only messages sent to a background or quit app are treated as low priority unless the message is high priority.
- Tap routing: `onNotificationOpenedApp` (backgrounded) and `getInitialNotification` (killed). We already do both correctly, including the cold-start race with the launch redirect.

### 2.5 Full-screen ride requests (Play policy)

Android 14+ restricts `USE_FULL_SCREEN_INTENT`. As of 22 January 2025 it is granted by default only to apps whose core function is calls or alarms; other apps must ask the user, and Play requires a declaration. The policy page does not name ride-hailing. **My reading, not a confirmed ruling: a driver app should not count on a full-screen ride-request screen over the lock screen.** Our design therefore relies on a high-importance heads-up notification plus the in-app overlay we already have, and on the driver keeping the app open while online (which the foreground location service already encourages).

### 2.6 Android 16 Live Updates

Android 16 adds `Notification.ProgressStyle` "Live Updates" for ongoing activities such as a ride or delivery: one persistent card, updated in place, shown on the lock screen and status bar chip. Ride-share is Google's own example. The sources I found were secondary (Android Authority, vendor blogs), not Google's developer guidance, so treat this as a later enhancement to evaluate, not a commitment.

### 2.7 India specifics

- **SMS** must go through TRAI DLT: registered sender IDs and registered content templates, each with a template ID. Message categories are transactional, service-implicit, service-explicit and promotional. Promotional SMS needs recorded consent, honors DND, and is restricted to roughly 10:00–21:00. Sender-ID format rules differ between vendor pages, so confirm them with the DLT operator. Practical consequence: keep SMS for OTP and a few critical transactional messages; do not use SMS for campaigns.
- **Push** is not under DLT, but the same consent and timing norms are good practice for promotional pushes.

---

## 3. What we have today

### 3.1 Backend

**Flow.** Callers invoke `notifyOwner()` (`notifications.service.ts`), which (1) inserts a feed row in `notification_logs`, (2) looks up the owner's `device_tokens` and calls FCM `sendEachForMulticast`, (3) emits `notification:new` to the owner's socket room. Each leg is independently try/caught. Admins use `notifyAllAdmins()`. Message copy comes from `notification_templates` (editable in the admin portal) via `renderTemplate()`.

**What exists:**
- Tables: `device_tokens` (owner, token, platform, `last_seen_at`), `notification_logs` (feed rows with `read_at`, plus unused delivery columns `delivered_at`, `failed_at`, `retry_count`), `notification_templates`.
- API: register/unregister device, list feed (cursor), unread count, mark read, mark all read.
- Invalid-token deletion on `registration-token-not-registered` / `invalid-argument`.
- Ride-request push is once per ride and driver (Redis `SET NX`), routed to the `ride_requests_v2` channel.
- Chat pushes bypass the feed by design and are suppressed when the recipient has the chat screen open.

**Event inventory (from a code search of every send site):**

| Recipient | Events that notify today |
|---|---|
| Driver | `ride_request`, `ride_manual_request`, `ride_force_assigned`, `stop_added`, `pickup_updated`, `ride_chat_message`, `document_rejected`, `document_expiring`, `document_expired`, `profile_corrected`, `vehicle_corrected`, `account_suspended`, `driver_warning`, `session_ended_stale`, `wallet_low_balance`, trip-window nudge |
| Rider | `ride_accepted`, `ride_completed`, `payment_failed`, `stop_unreachable`, `ride_chat_message`, trip-window nudge |
| Admin | driver submitted, document rejection escalated, SOS, SOS unacknowledged, dispute SLA breach, cash discrepancy, force-assign reverted, call-masking credit low, daily digest |

**Events with no push (status changes that only go over the socket):** driver arrived, ride started, cancelled (by either side or system), no drivers found, driver reassigned. Also no notification found for: driver application approved or rejected, payout processed or failed, wallet top-up success, payment receipt, rating received, scheduled-ride reminder, promotions or announcements.

**Backend problems found:**
- **N-1** TTL, tag and collapse are set only for web push, not Android.
- The push `channelId` is chosen by the caller; only two values exist. There is no registry tying an event type to a channel, priority, TTL, collapse key, category or route.
- No queue: sends are inline in the request or job that triggered them, with no retry and no result recorded. `notification_logs` delivery columns are never populated for push.
- No preferences table, no promotional vs transactional distinction, no quiet hours.
- Token lifecycle: `last_seen_at` updates only on explicit registration; no age-based pruning job; the apps do not re-register on token refresh (no `onTokenRefresh` handler found).
- No admin way to send a notification (confirmed earlier: the Templates page only edits copy).

### 3.2 Driver app

**Does:** creates two channels (`default_v2` DEFAULT, `ride_requests_v2` HIGH with a vibration pattern); asks for permission and registers the FCM token at startup; routes warm and cold-start taps (`pushRouting.ts`, 15 types handled or deliberately ignored); shows ride requests live through the socket overlay; has a notifications screen reachable from a bell on Home and a Profile menu row; unregisters the real token on logout.

**Missing or wrong:**
- No foreground handler: a document rejection or wallet-low push that arrives while the app is open is invisible (N-3).
- The Home bell has no unread badge; the count endpoint exists but is never called.
- Feed screen ignores the server's `notification:new` event, so it is stale until reopened.
- Tapping a feed item of an unrouted type (`account_suspended`, `driver_warning`, `session_ended_stale`, trip-window nudge) does nothing.
- No notification settings screen; no way to see that notifications are blocked at the OS level.
- Permission is requested at startup with no explanation.
- Only two channels; document/account alerts, chat and ride updates all share `default_v2` (DEFAULT importance, no heads-up).

### 3.3 Rider app

Same shape as the driver, with less:
- One channel, `default_v2` (N-4).
- Logout does not unregister the token (N-5).
- Routing handles only `ride_accepted`, `ride_completed`, `payment_failed`, `ride_chat_message`. Not handled: `stop_unreachable`, trip-window nudges.
- The notifications screen is reachable only from the Profile menu; there is no bell on Home and no unread indicator anywhere.
- Same missing foreground display, live updates, settings and permission priming.
- The notifications screen is a near-copy of the driver one (two copies to maintain).

### 3.4 The in-app notification section, as built

A flat list per app: title, body, timestamp, unread dot, tinted unread row, "Mark all read", cursor paging with a guard against double-appending, retry on load failure, and an "all caught up" empty state. Tapping marks the item read and routes by type.

What it lacks versus a complete notification center: unread badge on entry points; live insertion of new items; date grouping (Today / Yesterday / Earlier); an icon or colour per category; filters; pull-to-refresh; a way to clear or archive; a skeleton instead of a spinner; a visible state when OS notifications are off; a link to settings; and a safe fallback for unknown types.

---

## 4. Target design

### 4.1 One registry, one dispatcher

Replace ad-hoc `notifyOwner({ type, title, body, ... })` calls with a single code-defined registry. Every event type must have an entry, enforced by a unit test that scans for send sites.

```
registry['driver_arrived'] = {
  recipient: 'user',
  category: 'ride_updates',      // transactional, cannot be switched off
  channels: ['push', 'in_app', 'socket'],
  android: { channelId: 'ride_updates_v1', priority: 'high', ttlSeconds: 600, collapseKey: 'ride-{rideId}-status' },
  template: 'driver_arrived',    // existing notification_templates slug
  route: { rider: '/ride/{rideId}' },
  dedupe: 'ride:{rideId}:arrived',
}
```

`dispatch(eventType, recipient, context)` then: renders the template, checks preferences (promotional only), de-duplicates with `SET NX`, writes the feed row, enqueues a BullMQ job, and returns. The worker sends FCM with the correct Android config (`ttl`, `collapseKey`, `notification.tag`, `channelId`, `priority`), records the per-token result in `notification_logs` (`sent_at`, `failed_at`, `failure_reason`), and prunes dead tokens. `notifyOwner` stays as a thin wrapper during migration so existing callers keep working.

### 4.2 Payload contract

Every push carries the same `data` keys (all strings): `type`, `notificationId` (feed row id), `rideId` (optional), `category`, `sentAt`. Apps route on `type` as they do now, and any unknown `type` opens the notification center rather than doing nothing. The feed API already returns `payload` (verified), so a feed tap and a push tap can resolve identically.

### 4.3 Android channels

Importance cannot be changed later, so choose it once. New IDs use a `_v1` suffix on the new scheme; the old `_v2` ids stay as fallbacks so existing installs keep working.

**Driver**

| Channel | Importance | Carries |
|---|---|---|
| `ride_requests_v2` (exists) | HIGH | ride_request, ride_manual_request |
| `ride_updates_v1` | HIGH | force-assigned, stop added, pickup updated, ride cancelled by rider, trip-window nudge |
| `chat_v1` | HIGH | ride_chat_message |
| `account_alerts_v1` | HIGH | document rejected/expiring/expired, application approved/rejected, suspended, warning, wallet low, payout failed |
| `earnings_v1` | DEFAULT | payout processed, wallet top-up success, weekly summary |
| `announcements_v1` | LOW | ops notices, promotions (user-mutable) |
| `default_v2` (exists) | DEFAULT | fallback |

**Rider**

| Channel | Importance | Carries |
|---|---|---|
| `ride_updates_v1` | HIGH | accepted, driver arrived, started, completed, cancelled, no drivers, trip-window nudge, stop unreachable |
| `chat_v1` | HIGH | ride_chat_message |
| `payments_v1` | DEFAULT | receipt |
| `safety_v1` | HIGH | SOS acknowledgements |
| `offers_v1` | LOW | promotions (user-mutable) |
| `default_v2` (exists) | DEFAULT | fallback |

Note: importance belongs to the channel, not the message. `payment_failed` must interrupt, so it goes on the HIGH `ride_updates_v1` channel, and `payments_v1` carries receipts only.

Use channel groups only if we later add multiple accounts; not needed now.

### 4.4 Event catalog to implement

Priority legend: H = high priority and heads-up, D = default. TTL is how long FCM keeps it for an offline device.

**Rider (new events marked ★)**

| Event | Push | Feed | Priority | TTL | Collapse |
|---|---|---|---|---|---|
| ride_accepted | yes | yes | H | 1 h | ride status |
| ★ driver_arrived | yes | yes | H | 10 min | ride status |
| ★ ride_started | yes | yes | D | 10 min | ride status |
| ride_completed + receipt | yes | yes | D | 24 h | ride status |
| ★ ride_cancelled (driver/system) | yes | yes | H | 1 h | ride status |
| ★ no_drivers_found | yes | yes | H | 30 min | ride status |
| payment_failed | yes | yes | H | 24 h | per ride |
| stop_unreachable | yes | yes | H | 30 min | per ride |
| trip-window nudge | yes | yes | D | 30 min | per ride |
| ride_chat_message | yes | no | H | 1 h | per ride |
| ★ scheduled_ride_reminder | yes | yes | D | 1 h | per ride |
| ★ promotion | yes | yes | LOW | 24 h | per campaign |

**Driver (new events marked ★)**

| Event | Push | Feed | Priority | TTL | Collapse |
|---|---|---|---|---|---|
| ride_request | yes | no | H | dispatch window (≤30 s) | per ride |
| ride_force_assigned / manual_request | yes | yes | H | 60 s / 30 s | per ride |
| stop_added / pickup_updated | yes | yes | H | 30 min | per ride |
| ★ ride_cancelled_by_rider | yes | yes | H | 30 min | per ride |
| ride_chat_message | yes | no | H | 1 h | per ride |
| document_rejected / expiring / expired | yes | yes | H | 7 d | per document |
| ★ rc_back_required (this RC change) | yes | yes | H | 7 d | one key |
| ★ application_approved / rejected | yes | yes | H | 7 d | one key |
| account_suspended / driver_warning | yes | yes | H | 7 d | none |
| wallet_low_balance | yes | yes | D | 24 h | one key |
| ★ wallet_topup_success, payout_processed/failed | yes | yes | D / H for failure | 24 h | per txn |
| session_ended_stale | yes | yes | D | 1 h | one key |
| ★ announcement | yes | yes | LOW | 24 h | per campaign |

### 4.5 Client behaviour (both apps, built once in `mobile-shared`)

- **Foreground:** register `setNotificationHandler` with `shouldShowBanner` and `shouldShowList` true, sound only for HIGH events. Handle `onMessage` to show an in-app toast/banner for events that have no live UI on the current screen, and skip it when the user is already looking at the relevant screen (for example the chat screen). Ride requests keep their existing overlay.
- **Background and killed:** keep the existing tap handlers; add `setBackgroundMessageHandler` only if we later send data-only messages.
- **Token:** re-register on token refresh and on app start (updates `last_seen_at`); unregister the real token on logout (fixes N-5).
- **Permission:** do not prompt at launch. Prompt after login with a short explanation ("Ride updates and document alerts"), and if denied show a persistent banner in the notification center with a button to system settings.
- **Entry points:** a bell with an unread badge on Home in both apps; keep the Profile row. Badge count from the existing `unread-count` endpoint, kept live by the `notification:new` event.

### 4.6 Notification center v2 (shared component)

One implementation in `mobile-shared`, parameterised by the app's `api`, `router` and route resolver, replacing the two near-identical copies.

- Header: back, title, "Mark all read", settings gear.
- Optional banner: "Notifications are off. Turn on" when the OS permission or a channel is blocked.
- Filter chips: All, Rides, Account/Payments, Offers.
- Sections by day: Today, Yesterday, Earlier.
- Row: category icon and colour, title, two-line body, relative time, unread dot, swipe to dismiss.
- Behaviour: pull to refresh; new items inserted live from `notification:new`; skeleton on first load; cursor paging with the existing double-append guard; tap marks read then routes; unknown type opens nothing but is not a dead tap (it stays and marks read); empty state per filter.
- Accessibility: row labelled with title, body and read state.

### 4.7 Preferences and settings

- **Server:** `notification_preferences(owner_type, owner_id, category, push_enabled, updated_at)` with only the *optional* categories (announcements, offers). Transactional categories (ride updates, chat, payments, account alerts, safety) are not stored and cannot be disabled in-app, because blocking a "driver arrived" or "document rejected" breaks the product; users who want that can still use Android's channel settings.
- **App:** a Notification settings screen listing each channel with a switch for the optional ones, and a "Manage in system settings" row that opens the OS channel settings.
- **Quiet hours** apply to promotional sends only (default 21:00–10:00).

### 4.8 Delivery tracking and observability

- Populate `notification_logs`: queued → sent (FCM accepted) → failed with reason; client acks `delivered`/`opened` by `notificationId` when a push is received or tapped (a small `POST /notifications/:id/ack`).
- Prometheus counters, since the stack already has prom-client: `notifications_sent_total{type,channel}`, `notifications_failed_total{reason}`, `push_invalid_tokens_total`, and a send-latency histogram. An alert on a sudden rise in failures or invalid tokens.
- Token hygiene job (daily): delete tokens not seen in 60 days; the apps refresh `last_seen_at` on each start.

### 4.9 Admin broadcast

A page in the admin portal (super-admin and ops-admin only):
- Compose: title, body, optional deep link (a registered route name, not free text), category (announcement or offer).
- Audience: all drivers, all riders, by city, or by condition (for example "drivers missing RC back"), with a recipient count preview before sending.
- Send now or schedule; sends run through the same queue in batches; per-campaign result counts (sent, failed, opened).
- Every send is written to the audit log with who, what and how many. A confirm step shows the count first.
- Promotional sends respect preferences and quiet hours; transactional notices (documents, maintenance) do not.

### 4.10 SMS

Keep SMS for OTP and, if wanted, ride confirmation as a fallback when the user has no push token. Do not use it for campaigns. Any new SMS template needs DLT registration first.

### 4.11 Later: Live Updates, iOS

Evaluate Android 16 Live Updates for the active ride after the rest ships. iOS needs APNs configuration in Firebase and a platform-aware dispatcher; the `platform` column already exists, but both apps are Android-only today.

---

## 5. Phased plan

Each phase lands on its own branch and can ship alone.

### Phase 0: fix what is broken (DONE, branch `feat/notifications-phase0`)

1. Android config in `push.provider.ts`: set `android.ttl`, `android.collapseKey`, `android.notification.tag` from the message. Test that a 30 s ride-request push sets a 30 s TTL.
2. Rider logout unregisters the real token (N-5).
3. Add rider push events: `driver_arrived`, `ride_started`, `ride_cancelled`, `no_drivers_found`, and driver push `ride_cancelled_by_rider`, with templates and routing (N-2). Highest priority of this phase because the rider socket now disconnects in the background.
4. Foreground display in both apps (`setNotificationHandler` + `onMessage` toast) (N-3).
5. Route the unrouted types, and make an unknown type open the notification center.
6. Re-register the token on refresh.
7. The RC back reminder (the one-off from the RC change) can use this path.

Acceptance: pushes from a killed, backgrounded and foreground app all show; a stale ride-request push does not appear after its window; rider logout stops pushes.

### Phase 1: registry, dispatcher, queue, channels (DONE, branch `feat/notifications-phase1`)

Built as: `notifications.registry.ts` (typed, compile-time enforced), `notifyOwner` as the dispatcher (queues the push, falls back to inline when Redis is down), a separate `push` BullMQ queue and worker (3 attempts, exponential backoff, TTL-aware, partial successes never retried), FCM outcome recorded on the feed row, payload contract (`type`, `notificationId`, `sentAt`, `rideId`). Channels actually created: driver `ride_requests_v2`, `ride_updates_v1`, `chat_v1`, `account_alerts_v1`; rider `ride_updates_v1`, `chat_v1`. The earnings, announcements, payments, safety and offers channels from section 4.3 are deliberately not created yet: an empty channel still shows up in the user's system settings, so each is added in the phase that first sends on it. Two items are deferred to where they first matter: the per-user rate cap (nothing low-priority sends yet; it belongs with the admin broadcast in Phase 3) and a generic `dedupeKey` on `notifyOwner` (ride events already dedupe inside `notifyRideEvent`).

Original scope:

1. Event registry and `dispatch()`, with a test that every `type` string used at a send site has a registry entry.
2. BullMQ send worker with retry and per-token result recording; `notifyOwner` becomes a wrapper.
3. New channels per section 4.3, created at app start; registry maps events to them. Keep `_v2` ids as fallback.
4. Payload contract (section 4.2) and feed API returning `payload`.
5. Redis dedupe keys and a per-user rate cap for non-critical events.

### Phase 2: in-app experience

1. Shared notification center v2 and a bell with a live unread badge on both Home screens.
2. Live insertion from `notification:new`.
3. Permission priming and the "notifications are off" banner.
4. Notification settings screen (read-only list plus link to system settings until Phase 3).

### Phase 3: preferences and admin broadcast

1. `notification_preferences` table and API; settings switches for optional categories.
2. Quiet hours for promotional sends.
3. Admin broadcast page, endpoint, audience filters, preview, scheduling and audit log.
4. Delivery acks and per-campaign stats.

### Phase 4: observability and extras

1. Metrics and alerts; daily stale-token pruning.
2. Evaluate Live Updates for the active ride; evaluate iOS support if an iOS release is planned.

### Testing

- Unit: registry completeness; payload building for each event; preference and quiet-hours logic; dedupe.
- Integration: dispatch writes a feed row and enqueues exactly once; invalid tokens are pruned.
- Device matrix (manual): Android 12, 13, 14, 15 with permission granted and denied; app killed, backgrounded, foreground; Doze after 30 minutes idle; channel disabled in system settings; ride-request TTL expiry.

---

## 6. Decisions needed

1. **Order.** I recommend Phase 0 now, because N-1 and N-2 are live defects. Confirm.
2. **Optional categories.** Is it correct that only announcements and offers are user-switchable, and everything else is mandatory?
3. **Promotions.** Do you plan promotional pushes soon? If not, Phase 3's quiet hours and the offers channel can wait while the admin broadcast still ships for operational notices.
4. **Rider arrival and start pushes.** Should "ride started" be a push or feed-only? I propose push at default importance.
5. **SMS fallback.** Do you want an SMS fallback for critical rider events when there is no push token, given the DLT template work and per-message cost?
6. **Full-screen driver ride requests.** Given the Android 14 restriction, are you comfortable with heads-up plus in-app overlay as the final design?
7. **iOS.** Is an iOS release planned? If yes, I would design the dispatcher platform-aware in Phase 1 rather than retrofit it.

---

## Sources

Official:
- [FCM: message types](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type)
- [FCM: manage registration tokens](https://firebase.google.com/docs/cloud-messaging/manage-tokens)
- [FCM: throttling and quotas](https://firebase.google.com/docs/cloud-messaging/throttling-and-quotas)
- [FCM: about messages (priority, TTL, collapse)](https://firebase.google.com/docs/cloud-messaging/concept-options)
- [Android: notification channels](https://developer.android.com/develop/ui/views/notifications/channels)
- [Android: notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)
- [Android: full-screen intent limits](https://source.android.com/docs/core/permissions/fsi-limits)
- [Google Play: foreground service and full-screen intent requirements](https://support.google.com/googleplay/android-developer/answer/13392821)
- [Expo Notifications SDK reference](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [React Native Firebase messaging usage](https://rnfirebase.io/messaging/usage)

Secondary (vendor or community pages; used for general patterns, not for exact limits):
- [Notification system design: preferences, dedupe, rate limiting](https://techinterview.org/system-design-notification-system/)
- [Designing Uber: notification service role](https://www.systemdesignhandbook.com/guides/design-uber/)
- [Plivo: DLT registration process for India](https://www.plivo.com/docs/sms/concepts/dlt-registration-process)
- [Android 16 Live Updates overview](https://www.androidauthority.com/android-16-live-updates-3556651/)

Not confirmed from an official page, so verify before building: the multicast batch cap of the Admin SDK, exact DLT sender-ID formats and promotional hours, and whether Play would accept a ride-request full-screen intent.
