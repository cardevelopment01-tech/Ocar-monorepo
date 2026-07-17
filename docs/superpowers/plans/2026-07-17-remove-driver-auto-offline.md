# Remove Driver Auto-Offline-on-Disconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the racy in-process 45-second grace-period timer that auto-flips a driver's session offline on socket disconnect, since the product decision is that this behavior isn't needed at all.

**Architecture:** Pure deletion from one file (`api/src/websocket/socket.server.ts`) — no new code, no new tests beyond manual verification. `driver_sessions.status` will only change via the driver's own explicit go-offline action or ride lifecycle events, both already unaffected by this file.

**Tech Stack:** Express + TypeScript, Socket.io.

**Spec:** `docs/superpowers/specs/2026-07-17-remove-driver-auto-offline-design.md`

---

### Task 1: Remove the grace-period timer and its cancellation/firing logic

**Files:**
- Modify: `api/src/websocket/socket.server.ts`

- [ ] **Step 1: Remove the module-level grace-period state**

Find this block (currently lines 19-23):

```typescript
// Grace period before marking a driver offline after socket disconnect.
// Cancels if the driver reconnects within the window, handles page refreshes
// and brief mobile network blips without flipping the driver's DB status.
const OFFLINE_GRACE_MS = 45_000
const pendingOffline = new Map<string, ReturnType<typeof setTimeout>>()
```

Delete it entirely, so the file goes directly from the room-naming-conventions comment block to `let io: Server` to `export function initSocketServer(...)`.

- [ ] **Step 2: Remove the reconnect-cancellation block**

Inside the `connection` handler, find this block (currently lines 64-72):

```typescript
    if (user?.role === 'driver') {
      // Cancel any pending offline timer, driver reconnected within grace period
      const pending = pendingOffline.get(user.sub)
      if (pending) {
        clearTimeout(pending)
        pendingOffline.delete(user.sub)
        console.log(`Driver ${user.sub} reconnected — offline grace period cancelled`)
      }
      void socket.join(`driver:${user.sub}`)
```

Replace it with:

```typescript
    if (user?.role === 'driver') {
      void socket.join(`driver:${user.sub}`)
```

(Everything after `void socket.join(\`driver:${user.sub}\`)` inside this `if` block — the ride-room rejoin query, the `ride:request:ack` handler, the `location:update` handler, and the pending-assignments redelivery — stays exactly as-is, unchanged.)

- [ ] **Step 3: Remove the disconnect-handler's auto-offline block**

Find this block inside `socket.on('disconnect', () => { ... })` (currently lines 184-218):

```typescript
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${user?.sub} (${user?.role})`)
      if (user?.role === 'driver') {
        const driverSub = user.sub
        // Start grace period instead of marking offline immediately.
        // If the driver reconnects (e.g. page refresh, brief network blip)
        // within OFFLINE_GRACE_MS the timer is cancelled above and the DB
        // session is left untouched.
        const timer = setTimeout(() => {
          pendingOffline.delete(driverSub)
          const driverId = BigInt(driverSub)
          // Only auto-offline an idle ('online') session on disconnect. A
          // driver mid-trip ('on_trip') who loses connectivity for a bit
          // (tunnel, dead zone, phone reboot) must not be silently flipped
          // offline — that's what stranded a still-active ride's session
          // state and made the driver app "go offline" on reconnect even
          // though the ride was still live (see
          // docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 3b). Whether an
          // on-trip driver has truly gone dark is judged by GPS-heartbeat
          // continuity instead — see cleanup.worker.ts's stuck-ride sweep.
          pool.query(
            `UPDATE driver_sessions SET status = 'offline', went_offline_at = now(), offline_reason = 'socket_disconnect'
             WHERE driver_id = $1 AND status = 'online'`,
            [driverId]
          ).then(() =>
            pool.query(
              `UPDATE driver_location_snapshots SET is_available = false WHERE driver_id = $1`,
              [driverId]
            )
          ).catch(() => {})
          console.log(`Driver ${driverSub} grace period expired — marked offline`)
        }, OFFLINE_GRACE_MS)
        pendingOffline.set(driverSub, timer)
      }
    })
```

Replace it with:

```typescript
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${user?.sub} (${user?.role})`)
    })
```

- [ ] **Step 4: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors. (Confirms `pool` and `BigInt` imports/usages elsewhere in the file are still needed and nothing is now an unused import — `pool` is still used by the ride-room rejoin query and the `join:ride` handler, so its import stays.)

- [ ] **Step 5: Run the unit test suite**

Run: `cd api && npx vitest run tests/unit`
Expected: all passing, same count as before this change (this file has no existing unit tests directly covering it — this just confirms nothing else broke).

- [ ] **Step 6: Manual verification**

Run: `cd api && pnpm dev` (requires a working Postgres + Redis connection and a valid `.env` — skip this step with a note if those aren't available in your environment, per the same caveat as prior work in this repo).

With a driver app connected and online:
1. Force-disconnect the driver's socket (e.g. close the driver app, or toggle airplane mode).
2. Wait at least 60 seconds (longer than the old 45s grace period).
3. Query `SELECT status FROM driver_sessions WHERE driver_id = <id> ORDER BY went_online_at DESC LIMIT 1` — expect `status = 'online'`, unchanged.
4. Reconnect the driver app, confirm it still functions normally (ride requests still arrive, location still updates).
5. Use the driver app's own "Go Offline" action — confirm `driver_sessions.status` still flips to `offline` correctly (this path is untouched by this change).

- [ ] **Step 7: Commit**

```bash
git add api/src/websocket/socket.server.ts
git commit -m "fix: remove racy auto-offline-on-disconnect, drivers stay online until they explicitly go offline"
```

---

## Post-implementation checklist

- [ ] `cd api && npx tsc --noEmit` — clean
- [ ] `cd api && npx vitest run tests/unit` — all passing
- [ ] Manual verification steps confirmed (or explicitly noted as skipped due to missing local Postgres/Redis/.env)
