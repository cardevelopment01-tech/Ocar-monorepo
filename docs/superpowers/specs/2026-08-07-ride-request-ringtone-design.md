# Ride-request ringtone: smooth, non-laggy, reliable

## Problem

When a ride broadcast reaches an online driver (`ride:request` socket event, `api/src/websocket/socket.server.ts:237`, room `driver:{driverId}`), the driver app plays an audio alert via `beep()` in `apps/driver/src/components/ui/TripRequestCard.tsx:65-82`. Drivers have reported the alert sometimes plays late or not at all.

**Root cause:** `beep()` constructs a brand-new `AudioContext` on every single ride request and starts oscillators on it immediately. Browsers create every new `AudioContext` in a `suspended` state until resumed from a real user gesture; resuming a freshly-created context asynchronously can lose the race with the oscillator's `start()` call, or silently never resume if the tab hasn't recently seen a qualifying gesture. No error surfaces — the surrounding `try/catch` swallows nothing meaningful, so failures look random.

Secondary fact worth designing around: background browser tabs do **not** mute audio playback (only `setInterval`/`setTimeout` get throttled), so a tab that's merely backgrounded — not screen-off/OS-suspended — should ring fine once the unlock bug above is fixed. The remaining risk is the driver's **screen turning off**, which can let mobile OSes suspend the tab outright.

## Approach

Replace the per-call synthesized beep with a single, pre-unlocked, reusable `<audio>` element playing a bundled ringtone file. Native `<audio>` looping (rung 4 of the ladder: native platform feature) replaces manual Web Audio oscillator wiring — less code, and the browser owns decode/loop timing instead of us.

## 1. Sound asset & unlock module

- New asset: `apps/driver/src/assets/sounds/ride-request.mp3` — short (2-3s), cleanly loopable, bundled via Vite import (hashed/cached with the rest of the app bundle, not served from `public/`).
- New module `apps/driver/src/lib/rideSound.ts`:
  - Owns one module-level `HTMLAudioElement` (`loop = true`, `preload = 'auto'`, `src` = the bundled asset).
  - `unlockRideSound()` — does a muted `play()` immediately followed by `pause()`. This is the standard trick to satisfy the browser's gesture-origination requirement for audio without producing sound. Idempotent; safe to call more than once.
  - `playRideSound()` — resets `currentTime = 0`, calls `.play()`, `.catch()`s into a no-op (vibration already covers the fallback UX).
  - `stopRideSound()` — `.pause()`, resets `currentTime = 0` so a rapid second request never resumes mid-loop.

## 2. Unlock call sites

Called from the driver's real "Go Online" tap, well before any request can arrive:
- `apps/driver/src/pages/GoOnline/StandardConfirm.tsx:56` (`handleGoOnline`)
- `apps/driver/src/pages/GoOnline/ReturnCabSetup.tsx:57` (`handleGoOnline`)

Both currently call `driverRideApi.goOnline(...)` independently (no shared session-store wrapper exists to hook once) — add `unlockRideSound()` at the top of each handler.

## 3. Wiring into the request lifecycle

- `apps/driver/src/App.tsx` — the `ride:request` socket handler (~lines 203-241) currently only calls `setIncomingRequest(...)`. Add `playRideSound()` there, so sound fires the instant the event lands — decoupled from `TripRequestCard` mounting/rendering, eliminating any React-render-cycle delay.
- `TripRequestCard.tsx` — remove `beep()` (lines 65-82) and its call in the mount `useEffect` (line 100). The card no longer owns sound; existing vibration calls (`navigator.vibrate`) are untouched — no reported issues there.
- `stopRideSound()` is called wherever `incomingRequest` is cleared in `App.tsx` (accept, decline, and the card's own `handleExpire` path at `TripRequestCard.tsx:94-97` bubbles up to the same clear).

## 4. Reliability properties this produces

- One persistent, pre-unlocked `<audio>` element replaces per-request `AudioContext` creation — removes the suspended-context race that caused silent/delayed alerts.
- `playRideSound()`'s `.play()` promise rejection (e.g. a driver who reached an online state without going through the normal Go Online tap — a rare restored-session edge case) is swallowed, not thrown; vibration (already unconditional and working) still fires as the fallback alert.
- Reset-before-play/stop guards against overlapping loops on rapid consecutive requests.

## 5. Backgrounded-tab handling (best effort, no native app)

Since background tabs don't mute audio, the fix above already covers "app open, screen on, different tab" for free. The one real remaining gap is **screen-off suspension**:
- While `isOnline` is true, request a Screen Wake Lock (`navigator.wakeLock.request('screen')`); release it when going offline. This is the actual point of failure (screen sleep → OS may suspend the tab), not the audio pipeline.
- No FCM/service-worker changes — the fully-backgrounded/killed-app case is already handled by the existing push path (`apps/driver/public/firebase-messaging-sw.js`), which is a separate, already-functioning mechanism and out of scope here.

## Out of scope

- Custom sound on OS-level push notifications (not controllable from Web Push on most platforms — see prior discussion; would require a native shell).
- Any PWA/service-worker restructuring beyond what already exists for FCM.

## Testing

No existing test harness covers audio/DOM timing in this repo, and none is warranted for a straightforward play/pause wrapper. One manual verification replaces it: go online on a real mobile browser, background the tab for 30s, trigger a test ride request, confirm the ringtone fires immediately and stops cleanly on accept/decline/expiry.
