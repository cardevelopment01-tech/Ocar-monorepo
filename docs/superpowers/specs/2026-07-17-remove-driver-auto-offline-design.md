# Remove Driver Auto-Offline-on-Disconnect — Design Spec

**Date:** 2026-07-17
**Status:** Approved
**Author:** Claude (with Sujal Kumar Ghosh)

## Problem

`api/src/websocket/socket.server.ts` has a race condition (originally flagged as audit item Phase 0.2): a driver's 45-second offline grace-period timer is stored in an in-process `Map` (`pendingOffline`). If a driver disconnects from API instance A and reconnects to instance B, B has no way to see or cancel A's timer, and A flips the driver offline 45s later regardless — even though the driver is live on B. This is silent today (single instance) but becomes a real bug the moment the API scales to 2+ instances.

Per product direction, this entire behavior is unnecessary: a driver does not need to be automatically marked offline on socket disconnect at all. The existing per-ride broadcast/ACK-timeout mechanism (`ack-check.processor.ts`, `BROADCAST_WINDOW_SECONDS`) already tolerates an unresponsive driver — if a genuinely-disconnected driver doesn't acknowledge a ride request within the window, the system moves to the next driver in the broadcast round. So the auto-offline logic isn't load-bearing for correctness; it only exists to keep `driver_sessions.status` "tidy."

## Goal

Remove the auto-offline-on-disconnect logic entirely, eliminating the race condition by eliminating the feature it was protecting — rather than patching it with cross-instance coordination (e.g. a Redis-backed marker) for a behavior that isn't actually wanted.

## Non-goals

- Building any replacement mechanism for detecting/handling truly-gone drivers. The existing broadcast/ACK-timeout flow is the accepted backstop.
- Handling the edge case of a driver who never manually goes offline across a midnight boundary (their session simply stays online indefinitely until they act, or ride completion ends it). Not solved here — solving it would mean re-introducing some form of forced-offline behavior, which conflicts with this change's purpose.

## Design

Delete from `api/src/websocket/socket.server.ts`:
- The `OFFLINE_GRACE_MS` constant and `pendingOffline` Map (module-level state).
- The pending-timer-cancellation block inside the `connection` handler's driver branch (the block that does `pendingOffline.get(user.sub)` / `clearTimeout` / `pendingOffline.delete`).
- The entire `setTimeout`-based grace-period block inside the `disconnect` handler's driver branch (the block that eventually runs `UPDATE driver_sessions SET status = 'offline' ...` and `UPDATE driver_location_snapshots SET is_available = false ...`).

Nothing else in the file changes. `driver_sessions.status` now only transitions via:
- The driver's own explicit "Go Offline" action (`POST /api/v1/rides/sessions/offline`).
- Ride lifecycle events (ride completion, forced admin resolution, etc.) — unaffected by this change.

## Testing

This is a pure deletion with no new logic — nothing to unit test. Manual verification: connect as a driver, disconnect the socket (e.g. close the app), confirm `driver_sessions.status` remains `online` after 45+ seconds (no auto-flip), and confirm going online/offline explicitly still works normally.
