# Ride-Request Ringtone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the driver app's per-request synthesized `beep()` (which silently fails/lags due to browsers creating each new `AudioContext` suspended) with a single, pre-unlocked, looping `<audio>` element, plus a best-effort Screen Wake Lock so the driver's screen doesn't sleep and suspend the tab while online.

**Architecture:** One persistent `HTMLAudioElement` wrapped by three functions (`unlockRideSound`/`playRideSound`/`stopRideSound`) in a new `apps/driver/src/lib/rideSound.ts`. The element is unlocked once, on the driver's real "Go Online" tap (a genuine user gesture), so by the time a `ride:request` socket event arrives later, `.play()` fires with no permission gate. Play/stop is driven by a single `useEffect` in `App.tsx` watching `incomingRequest` (already the one source of truth for "a request is currently showing"), so every existing clear path (accept, decline, expire, server-side expiry) stops the sound for free without touching 4 separate call sites.

**Tech Stack:** Vite 5 static asset import, native `HTMLAudioElement`, Zustand (`useRideStore`, `useSessionStore` — already in use), Screen Wake Lock API.

---

### Task 1: Generate the ringtone audio asset

**Files:**
- Create (temporary, not committed): `C:\Users\Evatril\AppData\Local\Temp\claude\C--Users-Evatril-Desktop-self-cab-booking-platform\589faf12-7f01-4fe6-ae3b-dbcbe12faf96\scratchpad\gen-ringtone.mjs`
- Create (committed): `apps/driver/src/assets/sounds/ride-request.wav`

No network fetch, no new dependency, no licensing risk — synthesize a small seamless-loop WAV with plain Node (`fs`, `Buffer`, `Math`), reusing the exact three-tone pattern (880Hz → 1100Hz → 880Hz) the old `beep()` used, so the new sound is recognizable but now a real bundled asset instead of a live-synthesized oscillator.

- [ ] **Step 1: Write the generator script**

```js
// gen-ringtone.mjs
import fs from 'node:fs'

const SAMPLE_RATE = 22050
const LOOP_SECONDS = 1.3 // silence tail makes the loop point inaudible

function writeWav(path, samples, sampleRate) {
  const dataSize = samples.length * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)   // PCM
  buffer.writeUInt16LE(1, 22)   // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28) // byte rate (mono, 16-bit)
  buffer.writeUInt16LE(2, 32)   // block align
  buffer.writeUInt16LE(16, 34)  // bits per sample
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  fs.writeFileSync(path, buffer)
}

function addTone(samples, startSample, sampleRate, freq, durationSec, amplitude, fadeSec = 0.012) {
  const n = Math.floor(durationSec * sampleRate)
  const fadeSamples = Math.floor(fadeSec * sampleRate)
  for (let i = 0; i < n; i++) {
    let env = 1
    if (i < fadeSamples) env = i / fadeSamples
    else if (i > n - fadeSamples) env = (n - i) / fadeSamples
    samples[startSample + i] += Math.sin((2 * Math.PI * freq * i) / sampleRate) * amplitude * env
  }
}

const totalSamples = Math.floor(LOOP_SECONDS * SAMPLE_RATE)
const samples = new Float32Array(totalSamples)

addTone(samples, Math.floor(0.00 * SAMPLE_RATE), SAMPLE_RATE, 880,  0.12, 0.5)
addTone(samples, Math.floor(0.18 * SAMPLE_RATE), SAMPLE_RATE, 1100, 0.12, 0.5)
addTone(samples, Math.floor(0.36 * SAMPLE_RATE), SAMPLE_RATE, 880,  0.12, 0.5)

writeWav(new URL('./ride-request.wav', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), samples, SAMPLE_RATE)
console.log('wrote ride-request.wav')
```

- [ ] **Step 2: Run it and move the output into the app**

Run: `node "C:\Users\Evatril\AppData\Local\Temp\claude\C--Users-Evatril-Desktop-self-cab-booking-platform\589faf12-7f01-4fe6-ae3b-dbcbe12faf96\scratchpad\gen-ringtone.mjs"`
Expected: prints `wrote ride-request.wav`, creates a `.wav` file (~56KB) next to the script.

Then create the destination directory and copy the file:
```powershell
New-Item -ItemType Directory -Force apps/driver/src/assets/sounds
Copy-Item "C:\Users\Evatril\AppData\Local\Temp\claude\C--Users-Evatril-Desktop-self-cab-booking-platform\589faf12-7f01-4fe6-ae3b-dbcbe12faf96\scratchpad\ride-request.wav" apps/driver/src/assets/sounds/ride-request.wav
```

Expected: `apps/driver/src/assets/sounds/ride-request.wav` exists, ~56KB.

- [ ] **Step 3: Sanity-check playback**

Open the file in any media player (double-click in Explorer) — confirm it plays a short three-note chime with no clicks/pops and loops without an audible gap if played twice back to back.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/assets/sounds/ride-request.wav
git commit -m "feat(driver): add generated ride-request ringtone asset"
```

---

### Task 2: Create the `rideSound` module

**Files:**
- Create: `apps/driver/src/lib/rideSound.ts`

- [ ] **Step 1: Write the module**

```ts
import ringtoneUrl from '@/assets/sounds/ride-request.wav'

let audio: HTMLAudioElement | null = null

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(ringtoneUrl)
    audio.loop = true
    audio.preload = 'auto'
  }
  return audio
}

/**
 * Must be called from a real user gesture (the driver's "Go Online" tap).
 * Browsers create every new playback session gated behind a user gesture;
 * doing a muted play/pause here means later calls to `playRideSound()` -
 * triggered by a server socket event, not a gesture - aren't blocked.
 */
export function unlockRideSound(): void {
  const el = getAudio()
  el.muted = true
  el.play()
    .then(() => {
      el.pause()
      el.currentTime = 0
      el.muted = false
    })
    .catch(() => { el.muted = false })
}

export function playRideSound(): void {
  const el = getAudio()
  el.currentTime = 0
  el.play().catch(() => {})
}

export function stopRideSound(): void {
  if (!audio) return
  audio.pause()
  audio.currentTime = 0
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no new errors. (If the `.wav` import errors with "cannot find module", Vite's `import.meta.glob`/asset typing needs `vite/client` in `tsconfig` types — check `apps/driver/src/vite-env.d.ts` already has `/// <reference types="vite/client" />`; every Vite app scaffold includes this, so it should already resolve.)

- [ ] **Step 3: Commit**

```bash
git add apps/driver/src/lib/rideSound.ts
git commit -m "feat(driver): add rideSound module for reliable ringtone playback"
```

---

### Task 3: Unlock audio on the Go Online tap

**Files:**
- Modify: `apps/driver/src/pages/GoOnline/StandardConfirm.tsx:56`
- Modify: `apps/driver/src/pages/GoOnline/ReturnCabSetup.tsx:57`

- [ ] **Step 1: Import and call `unlockRideSound()` in `StandardConfirm.tsx`**

Add the import near the other `@/lib` imports (after line 7):
```ts
import { unlockRideSound } from '@/lib/rideSound'
```

Add the call as the first line inside `handleGoOnline` (line 56):
```ts
const handleGoOnline = async () => {
  unlockRideSound()
  if (!vehicle) { setError('No active vehicle found. Add one in your profile.'); return }
```

- [ ] **Step 2: Same change in `ReturnCabSetup.tsx`**

Add the import near the other `@/lib` imports (after line 10):
```ts
import { unlockRideSound } from '@/lib/rideSound'
```

Add the call as the first line inside `handleGoOnline` (line 57):
```ts
const handleGoOnline = async () => {
  unlockRideSound()
  if (!vehicle)       { setError('No active vehicle found.'); return }
```

- [ ] **Step 3: Typecheck both apps compile**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/pages/GoOnline/StandardConfirm.tsx apps/driver/src/pages/GoOnline/ReturnCabSetup.tsx
git commit -m "feat(driver): unlock ringtone audio on Go Online tap"
```

---

### Task 4: Remove the old synthesized beep from `TripRequestCard`

**Files:**
- Modify: `apps/driver/src/components/ui/TripRequestCard.tsx:65-82,99-113`

- [ ] **Step 1: Delete the `beep()` function**

Remove lines 65-82 (the whole `function beep() { ... }` block).

- [ ] **Step 2: Remove the `beep()` call from the mount effect**

Current (lines 99-113):
```ts
  useEffect(() => {
    beep()
    try { navigator.vibrate([180, 80, 180]) } catch (_) {}
    const id = setInterval(() => {
      setTime(t => {
        if (t === 6 && !tickedAt5s.current) { tickedAt5s.current = true; try { navigator.vibrate(50) } catch (_) {} }
        if (t <= 1) { clearInterval(id); handleExpire(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => {
      clearInterval(id)
      if (expireTimeoutRef.current) clearTimeout(expireTimeoutRef.current)
    }
  }, [handleExpire])
```

Change to:
```ts
  useEffect(() => {
    try { navigator.vibrate([180, 80, 180]) } catch (_) {}
    const id = setInterval(() => {
      setTime(t => {
        if (t === 6 && !tickedAt5s.current) { tickedAt5s.current = true; try { navigator.vibrate(50) } catch (_) {} }
        if (t <= 1) { clearInterval(id); handleExpire(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => {
      clearInterval(id)
      if (expireTimeoutRef.current) clearTimeout(expireTimeoutRef.current)
    }
  }, [handleExpire])
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/components/ui/TripRequestCard.tsx
git commit -m "refactor(driver): remove synthesized beep, sound now owned by rideSound module"
```

---

### Task 5: Play/stop the ringtone from `App.tsx`

**Files:**
- Modify: `apps/driver/src/App.tsx`

- [ ] **Step 1: Import the module**

Add near the other `@/lib` imports at the top of `App.tsx`:
```ts
import { playRideSound, stopRideSound } from '@/lib/rideSound'
```

- [ ] **Step 2: Add a single effect keyed on `incomingRequest`**

Add this new effect directly after the existing `ride:request_expired` listener effect (after line 257, before the "Listen for user-initiated cancellation" comment at line 259):

```ts
  // Ringtone follows incomingRequest as the single source of truth: it starts
  // the instant a request is set and stops on every path that clears it
  // (accept, decline, expire, server-side expiry) without duplicating the
  // stop call at each of those call sites.
  useEffect(() => {
    if (incomingRequest) playRideSound()
    else stopRideSound()
  }, [incomingRequest])
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/App.tsx
git commit -m "feat(driver): play ride-request ringtone on incoming request, stop on clear"
```

---

### Task 6: Screen Wake Lock while online

**Files:**
- Modify: `apps/driver/src/App.tsx`

- [ ] **Step 1: Add a wake-lock effect keyed on `isOnline`**

Add directly after the effect from Task 5:

```ts
  // Best-effort: keep the screen from sleeping while online, since a sleeping
  // screen is the one case where a backgrounded tab's audio can actually get
  // suspended by the OS. Silently no-ops on browsers without the API
  // (cast to unknown avoids depending on lib.dom's WakeLock typings being
  // present in every TS target this repo might build with).
  useEffect(() => {
    if (!isOnline) return
    const nav = navigator as unknown as { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }
    let sentinel: { release: () => Promise<void> } | null = null
    nav.wakeLock?.request('screen').then(s => { sentinel = s }).catch(() => {})
    return () => { sentinel?.release().catch(() => {}) }
  }, [isOnline])
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/driver/src/App.tsx
git commit -m "feat(driver): request screen wake lock while online"
```

---

### Task 7: Manual verification

No automated test framework exists in `apps/driver` (confirmed: no vitest/jest in `package.json`), and this repo's own spec for this feature already calls for manual verification instead — consistent with how the rest of the driver app's UI-timing code (e.g. the existing vibration calls) is verified.

- [ ] **Step 1: Build check**

Run: `cd apps/driver && pnpm build`
Expected: build succeeds, no TypeScript errors, `ride-request.wav` appears in the `dist/assets` output with a hashed filename.

- [ ] **Step 2: Manual device check**

On a real mobile browser (not just desktop devtools — mobile autoplay policies differ):
1. Log in as a driver, tap "Go Online".
2. From another session (or the admin/user app), trigger a test ride broadcast to this driver.
3. Confirm the ringtone plays immediately (no delay) and loops cleanly.
4. Background the tab for 30 seconds, trigger another test request, confirm it still rings.
5. Accept a request — confirm the ringtone stops immediately.
6. Let a request expire without acting — confirm the ringtone stops when the card dismisses.
7. Confirm the screen does not dim/lock while online (wake lock working), and turns off normally once the driver goes offline.

- [ ] **Step 3: Update CLAUDE.md if needed**

If manual testing reveals the driver app now has a `apps/driver/src/lib/rideSound.ts` worth noting in the "Key File Locations" table in `CLAUDE.md`, add one line there. Otherwise skip — this is a small enough addition not to warrant a doc update on its own.
