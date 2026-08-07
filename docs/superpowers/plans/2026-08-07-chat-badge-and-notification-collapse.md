# Unread Chat Badge + stop_added Push Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the ride-chat entry buttons a live unread-message badge (the "vanishable" indicator that replaces having chat show up in the shared notification tab), and stop the `stop_added` notification from stacking multiple OS pushes for the same ride.

**Architecture:** Part A adds a `GET /rides/:id/messages/unread-count` endpoint to the existing `ride-chat` module, and threads an unread count through each app's already-open ride socket (live increment on `chat:message`, cleared when the chat screen is opened) into a small badge on the three chat entry buttons (user `DriverMiniRow`, driver `NavigateToPickup`, driver `TripInProgress`). Part B threads the `tag` collapse mechanism that `push.provider.ts` already supports (used by chat, per the previous change) through the shared `notifyOwner()` helper, then applies it to the one other notification type that can legitimately repeat per ride: `stop_added`.

**Tech Stack:** Express 4 + TypeScript, PostgreSQL (`pg` pool), Socket.io v4, Vitest (unit tests, backend only — this repo's established convention, see the original ride-chat plan). Frontend: Next.js 16 (user app), Vite 5 + React 19 + Zustand (driver app).

**Research/scope note:** I checked every `notifyOwner()` call site in the codebase before planning Part B. `ride_accepted`, `ride_completed`, `profile_corrected`, `vehicle_corrected`, `document_rejected` are all one-shot events (fire once per ride/action) — collapsing them would be solving a problem that doesn't exist. Only `stop_added` can fire multiple times for the same ride (a rider can add several mid-ride stops), so Part B is scoped to just that call site plus the shared `tag` plumbing — not a generic "collapse everything" mechanism, which would be over-engineering for the actual volume here.

---

## Part A — Unread chat badge

### Task 1: Backend — `getUnreadMessageCount` repository function

**Files:**
- Modify: `api/src/modules/ride-chat/ride-chat.repository.ts`
- Test: `api/tests/unit/ride-chat/ride-chat.repository.test.ts`

- [ ] **Step 1: Write the failing test**

In `api/tests/unit/ride-chat/ride-chat.repository.test.ts`, add `getUnreadMessageCount` to the existing import block (currently `insertMessageIdempotent, listMessages, markMessagesRead`):

```ts
import {
  insertMessageIdempotent,
  listMessages,
  markMessagesRead,
  getUnreadMessageCount,
} from '@/modules/ride-chat/ride-chat.repository'
```

Then append this new `describe` block at the end of the file:

```ts
describe('getUnreadMessageCount', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('counts unread messages from the OTHER participant', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ count: '4' }], rowCount: 1 } as never)

    const count = await getUnreadMessageCount(1n, 'driver') // driver is the reader

    expect(count).toBe(4)
    expect(vi.mocked(pool.query).mock.calls[0]![1]).toEqual([1n, 'driver'])
    expect(String(vi.mocked(pool.query).mock.calls[0]![0])).toContain('sender_type <> $2')
  })

  it('returns 0 when there are no unread messages', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [{ count: '0' }], rowCount: 1 } as never)

    const count = await getUnreadMessageCount(1n, 'user')

    expect(count).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/unit/ride-chat/ride-chat.repository.test.ts`
Expected: FAIL — `getUnreadMessageCount` is not exported from the repository module.

- [ ] **Step 3: Implement the repository function**

In `api/src/modules/ride-chat/ride-chat.repository.ts`, add this function after `markMessagesRead` (the last function in the file):

```ts
// Count of messages from the OTHER participant that readerType hasn't read
// yet — backs the unread badge on the chat entry button. Named distinctly
// from notifications.repository.ts's getUnreadCount (the shared bell-feed
// counter) since both could plausibly be imported in the same file.
export async function getUnreadMessageCount(rideId: bigint, readerType: RideParticipantType): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM ride_messages
     WHERE ride_id = $1 AND sender_type <> $2 AND read_at IS NULL`,
    [rideId, readerType],
  )
  return Number(res.rows[0]?.count ?? 0)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run tests/unit/ride-chat/ride-chat.repository.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/ride-chat/ride-chat.repository.ts api/tests/unit/ride-chat/ride-chat.repository.test.ts
git commit -m "feat(ride-chat): add getUnreadMessageCount repository function"
```

---

### Task 2: Backend — `getUnreadCount` service function

**Files:**
- Modify: `api/src/modules/ride-chat/ride-chat.service.ts`
- Test: `api/tests/unit/ride-chat/ride-chat.service.test.ts`

- [ ] **Step 1: Write the failing test**

In `api/tests/unit/ride-chat/ride-chat.service.test.ts`, add `getUnreadMessageCount: vi.fn()` to the existing `vi.mock('@/modules/ride-chat/ride-chat.repository', ...)` block:

```ts
vi.mock('@/modules/ride-chat/ride-chat.repository', () => ({
  insertMessageIdempotent: vi.fn(),
  listMessages: vi.fn(),
  markMessagesRead: vi.fn(),
  getUnreadMessageCount: vi.fn(),
}))
```

Add `getUnreadCount` to the service import:

```ts
import { sendMessage, getUnreadCount } from '@/modules/ride-chat/ride-chat.service'
```

Then append this new `describe` block at the end of the file:

```ts
describe('getUnreadCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(RIDE as never)
  })

  it('returns the unread count for the resolved participant', async () => {
    vi.mocked(chatRepo.getUnreadMessageCount).mockResolvedValue(3)

    const result = await getUnreadCount(1n, { userId: 5n })

    expect(result).toEqual({ count: 3 })
    // caller is the user -> reader type passed to the repo is 'user'
    expect(chatRepo.getUnreadMessageCount).toHaveBeenCalledWith(1n, 'user')
  })

  it('rejects a non-participant caller', async () => {
    await expect(getUnreadCount(1n, { userId: 999n })).rejects.toMatchObject({ httpStatus: 403 })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/unit/ride-chat/ride-chat.service.test.ts`
Expected: FAIL — `getUnreadCount` is not exported from the service module.

- [ ] **Step 3: Implement the service function**

In `api/src/modules/ride-chat/ride-chat.service.ts`, add this function after `markRead` (the last function in the file):

```ts
export async function getUnreadCount(rideId: bigint, caller: ChatCaller): Promise<{ count: number }> {
  const p = await resolveParticipant(rideId, caller)
  const count = await repo.getUnreadMessageCount(rideId, p.senderType)
  return { count }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run tests/unit/ride-chat/ride-chat.service.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/ride-chat/ride-chat.service.ts api/tests/unit/ride-chat/ride-chat.service.test.ts
git commit -m "feat(ride-chat): add getUnreadCount service function"
```

---

### Task 3: Backend — controller + route for `GET /:id/messages/unread-count`

**Files:**
- Modify: `api/src/modules/ride-chat/ride-chat.controller.ts`
- Modify: `api/src/modules/ride-chat/ride-chat.routes.ts`

- [ ] **Step 1: Add the controller handler**

In `api/src/modules/ride-chat/ride-chat.controller.ts`, add this function after `getMessages`:

```ts
// ── GET /rides/:id/messages/unread-count ────────────────────────────
export async function getUnreadCount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rideId = BigInt(req.params['id']!)
    const result = await service.getUnreadCount(rideId, caller(req))
    res.json(result)
  } catch (err) { next(err) }
}
```

- [ ] **Step 2: Add the route**

In `api/src/modules/ride-chat/ride-chat.routes.ts`, add this line after `router.get('/:id/messages', ...)`:

```ts
router.get('/:id/messages/unread-count', authenticate(), controller.getUnreadCount)
```

The full route block should now read:

```ts
router.post('/:id/messages', authenticate(), chatMessageLimiter, controller.postMessage)
router.get('/:id/messages', authenticate(), controller.getMessages)
router.get('/:id/messages/unread-count', authenticate(), controller.getUnreadCount)
router.patch('/:id/messages/read', authenticate(), controller.markRead)
```

- [ ] **Step 3: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual smoke test**

Run: `cd api && pnpm dev` in one terminal. With a valid rider JWT for a ride with an assigned driver (`$TOKEN`, `$RIDE_ID`):

```bash
curl -s "http://localhost:3000/api/v1/rides/$RIDE_ID/messages/unread-count" -H "Authorization: Bearer $TOKEN"
# Expected: {"count":0} (or the real unread count if messages already exist)
```

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/ride-chat/ride-chat.controller.ts api/src/modules/ride-chat/ride-chat.routes.ts
git commit -m "feat(ride-chat): add GET /rides/:id/messages/unread-count route"
```

---

### Task 4: Backend verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full ride-chat + websocket suite**

Run: `cd api && npx vitest run tests/unit/ride-chat tests/unit/websocket`
Expected: all pass.

- [ ] **Step 2: Full build**

Run: `cd api && npm run build`
Expected: `tsc && tsc-alias` completes with no errors.

---

### Task 5: User app — chat API client method

**Files:**
- Modify: `apps/user/lib/ride-api.ts`

- [ ] **Step 1: Add `getUnreadChatCount`**

In `apps/user/lib/ride-api.ts`, add this method to the `rideApi` object, immediately after the existing `markChatRead` method:

```ts
  getUnreadChatCount: async (rideId: string): Promise<number> => {
    const res = await api.get(`/api/v1/rides/${rideId}/messages/unread-count`)
    return (res.data as { count: number }).count
  },
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/user/lib/ride-api.ts
git commit -m "feat(user): add getUnreadChatCount API client method"
```

---

### Task 6: User app — live unread count on the ride tracking page

**Files:**
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx`

- [ ] **Step 1: Add state**

In `apps/user/app/(main)/ride/[id]/page.tsx`, immediately above the socket `useEffect` that starts at (currently) line 409 (`useEffect(() => { if (!rideId) return; void loadRide() ...`), add:

```ts
  const [unreadChatCount, setUnreadChatCount] = useState(0)
```

- [ ] **Step 2: Fetch the initial count and listen for live increments**

Inside that same `useEffect`, right after the `connectSocket(); const socket = getSocket(); joinRideRoom(rideId)` lines, add the initial fetch:

```ts
    void rideApi.getUnreadChatCount(rideId).then(setUnreadChatCount).catch(() => {})
```

Then, alongside the other handler declarations (e.g. next to `onStopAdded`), add:

```ts
    const onChatMessage = (data: { senderType: 'user' | 'driver' }) => {
      if (data.senderType === 'driver') setUnreadChatCount(c => c + 1)
    }
```

Register and clean it up alongside the other `socket.on`/`socket.off` calls in the same effect:

```ts
    socket.on('chat:message', onChatMessage)
```

and in the cleanup function:

```ts
      socket.off('chat:message', onChatMessage)
```

- [ ] **Step 3: Pass the count down to `DriverMiniRow`**

Find the render call `<DriverMiniRow ride={ride} rideId={rideId} router={router} />` and change it to:

```tsx
                <DriverMiniRow ride={ride} rideId={rideId} router={router} unreadChatCount={unreadChatCount} />
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/user && npx tsc --noEmit`
Expected: TS error expected at this point — `DriverMiniRow` doesn't accept `unreadChatCount` yet. That's fixed in Task 7; proceed to it before verifying.

- [ ] **Step 5: Commit**

Commit together with Task 7 (they're one coherent change to the same file) — see Task 7 Step 3.

---

### Task 7: User app — badge UI on `DriverMiniRow`

**Files:**
- Modify: `apps/user/app/(main)/ride/[id]/page.tsx`

- [ ] **Step 1: Accept the new prop**

Change the `DriverMiniRow` function signature from:

```ts
function DriverMiniRow({ ride, rideId, router }: { ride: RideDetail | null; rideId: string; router: ReturnType<typeof useRouter> }) {
```

to:

```ts
function DriverMiniRow({ ride, rideId, router, unreadChatCount }: { ride: RideDetail | null; rideId: string; router: ReturnType<typeof useRouter>; unreadChatCount: number }) {
```

- [ ] **Step 2: Render the badge**

Change the chat button block from:

```tsx
      <button
        onClick={() => router.push(`/ride/${rideId}/chat`)}
        className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0"
        style={{ background: '#E4F8FA' }}
        aria-label="Message driver"
      >
        <MessageCircle size={14} style={{ color: '#0A9FB0' }} />
      </button>
```

to:

```tsx
      <button
        onClick={() => router.push(`/ride/${rideId}/chat`)}
        className="w-9 h-9 rounded-xl flex items-center justify-center active:scale-95 transition-transform flex-shrink-0 relative"
        style={{ background: '#E4F8FA' }}
        aria-label="Message driver"
      >
        <MessageCircle size={14} style={{ color: '#0A9FB0' }} />
        {unreadChatCount > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
            style={{ background: '#DC2626' }}
          >
            {unreadChatCount > 9 ? '9+' : unreadChatCount}
          </span>
        )}
      </button>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors (this resolves the Task 6 Step 4 error).

- [ ] **Step 4: Manual verification**

Run: `cd apps/user && pnpm dev`. Open an active ride with an assigned driver. Send a message from the driver side (or another session) and confirm a red badge with the count appears on the chat icon without a page refresh; open the chat and navigate back — badge should be gone (the chat screen already calls `markChatRead` on open, and this page re-fetches the count fresh on remount).

- [ ] **Step 5: Commit**

```bash
git add "apps/user/app/(main)/ride/[id]/page.tsx"
git commit -m "feat(user): live unread-message badge on the chat entry button"
```

---

### Task 8: Driver app — API client method + store fields

**Files:**
- Modify: `apps/driver/src/lib/ride-api.ts`
- Modify: `apps/driver/src/store/useRideStore.ts`

- [ ] **Step 1: Add `getUnreadChatCount` to the driver API client**

In `apps/driver/src/lib/ride-api.ts`, add this method to the `driverRideApi` object, immediately after the existing `markChatRead` method:

```ts
  getUnreadChatCount: async (rideId: string): Promise<number> => {
    const res = await api.get(`/api/v1/rides/${rideId}/messages/unread-count`)
    return (res.data as { count: number }).count
  },
```

- [ ] **Step 2: Add store state + actions**

In `apps/driver/src/store/useRideStore.ts`, add `unreadChatCount: number` to the `RideState` interface, right after `incomingRequest`:

```ts
  unreadChatCount: number
```

Add the two new action signatures to the interface, right after `clearIncomingRequest: () => void`:

```ts
  setUnreadChatCount: (count: number) => void
  incrementUnreadChatCount: () => void
```

In the `create<RideState>()` body, add the initial value next to `incomingRequest: null,`:

```ts
      unreadChatCount:  0,
```

Add the two action implementations, right after `clearIncomingRequest`:

```ts
      setUnreadChatCount: (count) =>
        set({ unreadChatCount: count }),

      incrementUnreadChatCount: () =>
        set((s) => ({ unreadChatCount: s.unreadChatCount + 1 })),
```

Change `clearRide` from:

```ts
      clearRide: () =>
        set({ activeRide: null, incomingRequest: null }),
```

to (reset the badge when the ride ends, same as `incomingRequest`):

```ts
      clearRide: () =>
        set({ activeRide: null, incomingRequest: null, unreadChatCount: 0 }),
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/lib/ride-api.ts apps/driver/src/store/useRideStore.ts
git commit -m "feat(driver): add unread chat count to ride-api client and ride store"
```

---

### Task 9: Driver app — wire live updates in `App.tsx`

**Files:**
- Modify: `apps/driver/src/App.tsx`

- [ ] **Step 1: Destructure the new store actions**

Change:

```ts
  const { incomingRequest, setIncomingRequest, clearIncomingRequest, setActiveRide, setRestoreChecked, clearRide, activeRide, updateStop, addStop } = useRideStore()
```

to:

```ts
  const { incomingRequest, setIncomingRequest, clearIncomingRequest, setActiveRide, setRestoreChecked, clearRide, activeRide, updateStop, addStop, setUnreadChatCount, incrementUnreadChatCount } = useRideStore()
```

- [ ] **Step 2: Fetch the initial count and listen for live increments**

In the `useEffect` scoped to `[activeRide?.id]` (currently starting `useEffect(() => { if (!activeRide) return; const socket = getDriverSocket() ...`), add the handler alongside `onStopUpdated`/`onStopAdded`:

```ts
    const onChatMessage = (data: { senderType: 'user' | 'driver' }) => {
      if (data.senderType === 'user') incrementUnreadChatCount()
    }
```

Register it with the other `socket.on` calls:

```ts
    socket.on('chat:message', onChatMessage)
```

And clean it up with the other `socket.off` calls:

```ts
      socket.off('chat:message', onChatMessage)
```

Right after the existing `socket.on(...)` registrations (before the `if (socket.connected) { ... }` block), add the initial fetch:

```ts
    void driverRideApi.getUnreadChatCount(activeRide.id).then(setUnreadChatCount).catch(() => {})
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/App.tsx
git commit -m "feat(driver): fetch and live-update unread chat count for the active ride"
```

---

### Task 10: Driver app — clear the badge when the chat screen opens

**Files:**
- Modify: `apps/driver/src/pages/ActiveRide/RideChat.tsx`

- [ ] **Step 1: Destructure `setUnreadChatCount`**

Change:

```ts
  const { activeRide, restoreChecked } = useRideStore()
```

to:

```ts
  const { activeRide, restoreChecked, setUnreadChatCount } = useRideStore()
```

- [ ] **Step 2: Clear the count on mount**

In the mount `useEffect` (the one that emits `chat:open`), add `setUnreadChatCount(0)` right after the `socket.emit('chat:open', { rideId })` line:

```ts
    socket.emit('chat:open', { rideId })
    setUnreadChatCount(0)
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/driver/src/pages/ActiveRide/RideChat.tsx
git commit -m "feat(driver): clear unread chat badge when the chat screen opens"
```

---

### Task 11: Driver app — badge UI on both active-ride screens

**Files:**
- Modify: `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx`
- Modify: `apps/driver/src/pages/ActiveRide/TripInProgress.tsx`

- [ ] **Step 1: `NavigateToPickup.tsx` — destructure `unreadChatCount`**

Change:

```ts
  const { activeRide, restoreChecked, updateRideStatus, clearRide } = useRideStore()
```

to:

```ts
  const { activeRide, restoreChecked, updateRideStatus, clearRide, unreadChatCount } = useRideStore()
```

- [ ] **Step 2: `NavigateToPickup.tsx` — render the badge**

Change the chat button from:

```tsx
                <button
                  className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center active:scale-95 transition-transform"
                  onClick={() => navigate('/ride/chat')}
                  aria-label="Message rider"
                >
                  <MessageCircle size={18} className="text-text-secondary" />
                </button>
```

to:

```tsx
                <button
                  className="w-11 h-11 rounded-full bg-surface-3 border border-border flex items-center justify-center active:scale-95 transition-transform relative"
                  onClick={() => navigate('/ride/chat')}
                  aria-label="Message rider"
                >
                  <MessageCircle size={18} className="text-text-secondary" />
                  {unreadChatCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 flex items-center justify-center text-[10px] font-bold text-white">
                      {unreadChatCount > 9 ? '9+' : unreadChatCount}
                    </span>
                  )}
                </button>
```

- [ ] **Step 3: `TripInProgress.tsx` — destructure `unreadChatCount`**

Change:

```ts
  const { activeRide, updateRideStatus, updateStop, arriveStop, setFare, clearRide } = useRideStore()
```

to:

```ts
  const { activeRide, updateRideStatus, updateStop, arriveStop, setFare, clearRide, unreadChatCount } = useRideStore()
```

- [ ] **Step 4: `TripInProgress.tsx` — render the badge**

Change the chat button from:

```tsx
                  <button
                    className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shadow-button active:scale-95 transition-transform"
                    onClick={() => navigate('/ride/chat')}
                    aria-label="Message rider"
                  >
                    <MessageCircle size={18} className="text-text-inverse" />
                  </button>
```

to:

```tsx
                  <button
                    className="w-11 h-11 rounded-full bg-primary flex items-center justify-center shadow-button active:scale-95 transition-transform relative"
                    onClick={() => navigate('/ride/chat')}
                    aria-label="Message rider"
                  >
                    <MessageCircle size={18} className="text-text-inverse" />
                    {unreadChatCount > 0 && (
                      <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 flex items-center justify-center text-[10px] font-bold text-white">
                        {unreadChatCount > 9 ? '9+' : unreadChatCount}
                      </span>
                    )}
                  </button>
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run the API and driver app. On an active ride (both before pickup on `NavigateToPickup` and after start on `TripInProgress`), send a message from the rider side and confirm the badge appears live without navigating away; open chat and confirm it clears.

- [ ] **Step 7: Commit**

```bash
git add apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx apps/driver/src/pages/ActiveRide/TripInProgress.tsx
git commit -m "feat(driver): unread chat badge on both active-ride chat entry points"
```

---

### Task 12: Part A cross-app verification gate

**Files:** none (verification only)

- [ ] **Step 1: API suite + build**

Run: `cd api && npx vitest run tests/unit/ride-chat tests/unit/websocket && npm run build`
Expected: all tests pass, build clean.

- [ ] **Step 2: User + driver typecheck**

Run: `cd apps/user && npx tsc --noEmit` and `cd apps/driver && npx tsc --noEmit`
Expected: no errors in either.

---

## Part B — Collapse repeat `stop_added` pushes

### Task 13: Thread an optional `tag` through `notifyOwner`

**Files:**
- Modify: `api/src/modules/notifications/notifications.service.ts`
- Test: `api/tests/unit/notifications/notify-owner-tag.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/unit/notifications/notify-owner-tag.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendEachForMulticast = vi.fn().mockResolvedValue({ responses: [{ success: true }] })
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(() => ({})),
  cert: vi.fn((x: unknown) => x),
  getApps: vi.fn(() => []),
  getApp: vi.fn(() => ({})),
}))
vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(() => ({ sendEachForMulticast })),
}))
vi.mock('@/config', () => ({
  config: { FCM_SERVICE_ACCOUNT_KEY: JSON.stringify({ project_id: 'test' }) },
}))
vi.mock('@/modules/notifications/notifications.repository', () => ({
  createInAppNotification: vi.fn().mockResolvedValue({ id: '1' }),
  getTokensForOwner: vi.fn().mockResolvedValue(['tok1']),
  deleteDeviceTokens: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendNotification: vi.fn() } }))

import { notifyOwner } from '@/modules/notifications/notifications.service'

describe('notifyOwner — tag pass-through', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards tag to the push payload when provided', async () => {
    await notifyOwner({
      ownerType: 'driver', ownerId: 9n, type: 'stop_added',
      title: 'New stop added', body: 'A stop was added', rideId: 1n, tag: 'stop:1',
    })

    const msg = sendEachForMulticast.mock.calls[0]?.[0] as Record<string, unknown>
    expect(msg.webpush).toMatchObject({ notification: { tag: 'stop:1', renotify: true } })
  })

  it('omits tag when not provided (existing callers unaffected)', async () => {
    await notifyOwner({
      ownerType: 'user', ownerId: 5n, type: 'ride_accepted',
      title: 'Driver on the way', body: 'Your driver is coming',
    })

    const msg = sendEachForMulticast.mock.calls[0]?.[0] as Record<string, unknown>
    expect(msg.webpush).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd api && npx vitest run tests/unit/notifications/notify-owner-tag.test.ts`
Expected: FAIL — the first case's `msg.webpush` is `undefined` because `notifyOwner` doesn't forward `tag` yet.

- [ ] **Step 3: Implement the pass-through**

In `api/src/modules/notifications/notifications.service.ts`, change the `notifyOwner` params type from:

```ts
export async function notifyOwner(params: {
  ownerType: NotifOwnerType
  ownerId: bigint
  type: string
  title: string
  body: string
  payload?: Record<string, unknown>
  rideId?: bigint
}): Promise<void> {
```

to:

```ts
export async function notifyOwner(params: {
  ownerType: NotifOwnerType
  ownerId: bigint
  type: string
  title: string
  body: string
  payload?: Record<string, unknown>
  rideId?: bigint
  // Collapses repeat pushes sharing the same tag into one OS notification
  // (webpush tag/renotify — see push.provider.ts) instead of stacking one per
  // event. Optional: most callers are one-shot events that don't need it.
  tag?: string
}): Promise<void> {
```

Then change the `pushToTokens` call from:

```ts
    await pushToTokens(tokens, {
      title: params.title,
      body: params.body,
      data: { type: params.type, ...(params.rideId !== undefined ? { rideId: params.rideId.toString() } : {}) },
    })
```

to:

```ts
    await pushToTokens(tokens, {
      title: params.title,
      body: params.body,
      data: { type: params.type, ...(params.rideId !== undefined ? { rideId: params.rideId.toString() } : {}) },
      ...(params.tag !== undefined ? { tag: params.tag } : {}),
    })
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd api && npx vitest run tests/unit/notifications/notify-owner-tag.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/notifications/notifications.service.ts api/tests/unit/notifications/notify-owner-tag.test.ts
git commit -m "feat(notifications): thread an optional collapse tag through notifyOwner"
```

---

### Task 14: Apply the collapse tag to `stop_added`

**Files:**
- Modify: `api/src/modules/rides/rides.service.ts`

- [ ] **Step 1: Add the tag to the `stop_added` notifyOwner call**

In `api/src/modules/rides/rides.service.ts`, change:

```ts
      await notifyOwner({
        ownerType: 'driver',
        ownerId: BigInt(ride.driver_id),
        type: 'stop_added',
        title: subject ?? 'New stop added',
        body,
        rideId,
      })
```

to:

```ts
      await notifyOwner({
        ownerType: 'driver',
        ownerId: BigInt(ride.driver_id),
        type: 'stop_added',
        title: subject ?? 'New stop added',
        body,
        rideId,
        // Several stops can be added to the same ride in quick succession —
        // collapse repeat pushes into one OS notification instead of stacking.
        tag: `stop:${rideId}`,
      })
```

- [ ] **Step 2: Typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the existing rides test suite**

Run: `cd api && npx vitest run tests/unit/rides`
Expected: all pass (no existing test asserts the exact shape of this `notifyOwner` call, so none should break — if one does, it's asserting an exact object match and needs `tag` added to its expectation).

- [ ] **Step 4: Commit**

```bash
git add api/src/modules/rides/rides.service.ts
git commit -m "feat(rides): collapse repeat stop_added pushes for the same ride"
```

---

### Task 15: Final verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full API suite + build**

Run: `cd api && npx vitest run tests/unit && npm run build`
Expected: all previously-passing suites still pass (the pre-existing `process.exit(1)` startup failures documented in CLAUDE.md are unrelated env-setup noise, not regressions — see the ride-chat plan's own verification gate for the same caveat); build clean.

- [ ] **Step 2: User + driver typecheck**

Run: `cd apps/user && npx tsc --noEmit` and `cd apps/driver && npx tsc --noEmit`
Expected: no errors in either.

---

## Self-Review notes (carried into the plan)

- **Spec coverage:** unread badge — backend count endpoint (T1–T4), user app live badge (T5–T7), driver app live badge on both entry screens (T8–T11), cross-verification (T12). Notification collapse — scoped by actual call-site research to `stop_added` only (T13–T14), verified (T15). Both "last two reviews" items from the prior conversation are covered.
- **TDD:** backend logic (T1, T2, T13) is test-first. Frontend has no unit tests, matching this repo's established convention (see the original ride-chat plan) — verified manually instead.
- **Type consistency:** `getUnreadMessageCount(rideId, readerType)` at the repository layer and `getUnreadCount(rideId, caller)` at the service layer match the existing `markMessagesRead`/`markRead` naming split in the same module. `unreadChatCount` is the field/prop name used consistently across the Zustand store, `App.tsx`, `NavigateToPickup.tsx`, `TripInProgress.tsx`, and `RideChat.tsx`.

## Open questions / risks flagged

1. **Driver app badge is per-active-ride, not per-screen.** Since `unreadChatCount` lives in the shared `useRideStore` (reset on `clearRide`), it's automatically consistent across `NavigateToPickup` and `TripInProgress` without extra wiring — confirmed this is correct because both screens read the same store slice.
2. **User app badge resets via remount, not an explicit decrement.** Navigating to `/ride/[id]/chat` and back fully unmounts/remounts the tracking page (different route), so the effect re-fetches the count fresh (now 0, since the chat screen already called `markChatRead`) rather than needing a live decrement message from the server. This matches how the existing `loadRide()` re-fetch already works on remount.
