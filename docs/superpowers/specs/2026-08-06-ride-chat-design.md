# Ride Chat (Rider ↔ Driver In-Ride Messaging) — Design

## Context

Riders and drivers currently coordinate ("where are you?", "I'm at the pickup point") only by phone call. `apps/user`'s ride tracking screen already has a "Message driver" affordance noted as a non-functional placeholder in `CLAUDE.md`'s Known UI Caveats; the driver app has no equivalent entry point at all. This adds real-time, per-ride text chat, modeled on the architecture patterns researched from Uber's public engineering writeups (persist-then-push, push-notification fallback for the offline party, at-least-once delivery with client-side dedup) and scoped to fit Ocar's existing infra rather than introducing new infrastructure categories.

Two prior research artifacts back this design (not committed, session-only):
- Chat architecture survey (Uber/Ola engineering patterns → mapping onto Ocar's existing Socket.io + `notifyOwner()` stack).
- 20K-concurrent-user scaling plan for the underlying socket infrastructure (multi-instance API + sticky sessions + Redis HA) — tracked separately as ops work, not part of this feature's implementation. See "Scaling notes for later" below.

## Scope (v1)

- Free-text chat, scoped to one `ride_id`, available for the lifetime the ride is active (mirrors the existing `ride:{rideId}` socket room lifecycle — no separate teardown logic).
- Read receipts (seen/unread).
- A static set of 5 canned quick-reply chips shown alongside the text input (no ML, no per-user history — just a hardcoded list).
- Retained indefinitely (same policy as `ride_status_history` / `dispute_messages` — no purge job).
- Real chat UI shipped in both `apps/user` and `apps/driver` in this pass, not backend-only.

Out of scope for v1 (explicitly deferred, not forgotten): ML smart-reply suggestions, media/image messages, message editing/deletion, group chat (dispatcher-in-the-loop), moderation/profanity filtering.

## Data model

New migration, e.g. `0xx_ride_chat.sql`:

```sql
CREATE TYPE ride_participant_type AS ENUM ('user', 'driver');

CREATE TABLE ride_messages (
  id BIGSERIAL PRIMARY KEY,
  ride_id BIGINT NOT NULL REFERENCES rides(id),
  sender_type ride_participant_type NOT NULL,
  sender_id BIGINT NOT NULL,
  body TEXT NOT NULL,
  client_msg_id UUID NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ride_messages_dedup_idx
  ON ride_messages (ride_id, sender_type, sender_id, client_msg_id);
CREATE INDEX ride_messages_ride_created_idx
  ON ride_messages (ride_id, created_at);
```

- One plain table, no partitioning (same call already made for `notification_logs` in `035_notifications_feed.sql`) — this table's shape (`ride_id`-scoped, append-only, one row per event) is flagged in `CLAUDE.md`'s pending DB-load-test note to get the same partitioning decision `ride_status_history` gets, from the same load test, not bespoke work now.
- `client_msg_id` (client-generated UUID) is both the retry-dedup key and the idempotency mechanism: insert via `ON CONFLICT (ride_id, sender_type, sender_id, client_msg_id) DO NOTHING RETURNING *`; if no row returns, `SELECT` the existing row by the same key and return that instead. No separate dedup table or logic.

## API — new `ride-chat` module (`api/src/modules/ride-chat/`, same shape as the `safety` module)

- `POST /api/v1/rides/:id/messages`
  Body: `{ body: string, clientMsgId: string }`.
  - Validates the caller is a participant on this ride (same participant check the socket layer already uses at `socket.server.ts`'s room-join ACL — reuse, don't reimplement).
  - Rate-limited per `(rideId, senderType, senderId)`: burst 5, then 1/sec — reuses whatever rate-limit middleware already exists in the API.
  - Insert (idempotent per above), then `socketEvents.emitChatMessage(rideId, row)`, then `notifyOwner()` for the *other* participant using a new `ride_chat_message` template.
- `GET /api/v1/rides/:id/messages?after=<id>`
  History fetch / reconnect catch-up. Cursor by `id`, ascending.
- `PATCH /api/v1/rides/:id/messages/read`
  Marks all unread messages from the other participant as read; emits `chat:read`.

## Realtime

- `socketEvents.emitChatMessage(rideId, row)` and `socketEvents.emitChatRead(rideId, { readerType })`, both `.to('ride:'+rideId).emit(...)` — reuses the room both rider and driver already join for ride tracking; no new room/auth logic.
- Reconnect catch-up: client tracks the last message `id` it has seen and calls `GET .../messages?after=` on reconnect, covering the case where Socket.IO's built-in `connectionStateRecovery` (2-minute buffer) is exceeded (app killed rather than backgrounded).

## Notifications

One new row in `notification_templates` (slug `ride_chat_message`, same shape as the existing M10 template rows) + a call to the already-built `notifyOwner()` — gives the non-active party an FCM push + in-app feed entry with zero new delivery infrastructure.

## Frontend

Both apps get a working chat screen, not just backend wiring:

- **Shared UI shape**: message bubbles (sender-aligned), text input + send button, 5 static canned-reply chips above the input ("On my way", "I'm at the pickup point", "Running a few min late", "Can't find you, please call", "Here"), single/double-tick read-receipt indicator consistent with this app's existing status-indicator conventions.
- **User app entry point**: `apps/user/app/(main)/ride/[id]/page.tsx` — replace the currently-nonfunctional "Message driver" affordance / add a chat icon button next to the existing `tel:` Call button in the driver-info row (~line 175).
- **Driver app entry points**: `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx` — add a chat button next to the existing Call button in the rider-info row (~line 570). `apps/driver/src/pages/ActiveRide/TripInProgress.tsx` currently has *no* rider-contact row at all — add one with the same chat button, closing that gap as part of this work rather than leaving chat unreachable once the trip starts.
- Both apps already hold an open socket connection scoped to the ride (`getDriverSocket()` on driver, the equivalent on user) — the chat screen listens on `chat:message`/`chat:read` on that existing connection; no new socket wiring.

### UI quality bar
The chat screens (message list, bubbles, input, canned-reply chips, read-receipt ticks, transitions between "sending → sent → seen" states) must read as premium and deliberately designed, not a generic chat-template drop-in, and must stay smooth under real interaction (no jank on message-list scroll, no layout thrash on keyboard open/close, no dropped frames on send animations). When the implementation plan reaches the frontend tasks, invoke `impeccable`, `ui-ux-pro-max`, `design-taste-frontend`, and `design-motion-principles` for that work — the visual/motion design of the two chat screens is explicitly in scope for those skills, not something the plan should design ad hoc.

## Error handling
- Non-participant calling the chat routes → 403, same pattern as other ride-scoped routes.
- Ride not active / not found → 404, matching existing ride route conventions.
- Duplicate `clientMsgId` (retry after a timeout) → idempotent return of the original row, not a new insert or an error.
- Rate limit exceeded → 429, client backs off and queues locally for retry (no message loss on the client side).

## Testing
- Unit tests (`api/tests/unit/ride-chat/`): participant-ACL rejection, idempotent insert-on-conflict dedup (same `clientMsgId` sent twice returns the same row), rate-limit trip on burst, `notifyOwner()` invoked for the recipient (not the sender) with the correct template slug.
- No new integration/E2E harness — follows the existing unit-test-only pattern already used for `rides`/`safety` modules in this repo.

## Scaling notes for later (not part of this implementation)
The chat feature itself adds negligible load (message writes bounded by concurrently-active rides, not total user count) and needs no scaling work of its own — it rides on existing infra (Socket.io room already joined by both parties, Redis adapter already wired, `notifyOwner()` already built). The infra-wide gap for a 20K-concurrent-user launch rush is that `docker-compose.prod.yml` currently runs a single API container with no redundancy and nginx isn't configured for sticky sessions — both are pre-existing platform concerns, not introduced by chat, and are deliberately tracked as separate ops work (multi-instance API + nginx `ip_hash` + graceful SIGTERM shutdown + confirming/adding Redis HA) rather than folded into this feature's implementation plan.
