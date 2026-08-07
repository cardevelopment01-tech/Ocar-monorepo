# Chat Cutoff + Premium Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock ride-chat to read-only once a ride reaches a terminal status, and elevate the chat screens' visual execution — premium header with correct rider/driver privacy asymmetry, refined bubbles/input/canned-replies, purposeful motion — using the app's **real, actually-shipped** brand (teal `#0A9FB0` + magenta `#DC3E93`), executed with more restraint and intentionality than it is today.

**Architecture:** Part A is a small backend enforcement change (ride-chat module already has the participant-resolution plumbing; this adds a status gate). Part B and C are frontend-only visual refinements of the two existing chat screens (`apps/user/.../ride/[id]/chat/page.tsx`, `apps/driver/.../RideChat.tsx`) — no new components, no new state beyond what's needed to know the ride's status.

**Tech Stack:** Express 4 + TypeScript, Vitest (backend TDD). Frontend: Next.js 16 (user), Vite 5 + React 19 (driver), Framer Motion, Tailwind, Zustand.

---

## Research summary (why this plan looks the way it does — corrected)

**⚠️ Correction from an earlier draft of this plan:** the first version of this plan assumed the repo's `DESIGN.md` (a "Confident Indigo" `#4F46E5`/`#7C3AED` system) was the real brand and that the chat screens' teal/magenta colors were an off-system drift to fix. **That was wrong.** Checking the actual, live `tailwind.config.ts` in both apps (not the docs file) shows:

| | `apps/admin` | `apps/user` | `apps/driver` |
|---|---|---|---|
| `primary` | `#4F46E5` (indigo) | `#0A9FB0` (teal) | `#0A9FB0` (teal) |
| brand gradient | — | `linear-gradient(135deg, #0A9FB0, #DC3E93)` | used ad-hoc (not a named token), same colors — confirmed in `OcarSpinner`, the app's actual branded loading indicator |

`DESIGN.md` documents the **admin app's** palette as if it were universal. It never was applied to user/driver. **Teal + magenta is the real, live, pervasively-used brand** in the two apps chat lives in — confirmed used across 17 files in the user app and 44 in the driver app (home, login, onboarding, wallet, every active-ride screen). The chat screens' existing teal/magenta values are **on-brand, not a bug** — the `impeccable` design-lint hook's "color outside DESIGN.md" warnings seen throughout this session were false positives, because the hook checks against the stale/wrong doc, not the real Tailwind config.

**So this is not a rebrand.** It's a refinement of how the *real* teal/magenta brand is executed in chat specifically — grounded in actual research on making a bold two-tone gradient brand read as premium rather than playful:

- *"Pale [neutral] should carry most screens, with [primary] for progress indicators, toggles, and functional states, while [accent] works best as a single standout for key milestones or confirmation states... this ensures the design feels sophisticated rather than playful or childish."* [(Modern App Colors: Design Palettes That Work In 2026)](https://webosmotic.com/blog/modern-app-colors/) [(Colors for Mobile App Design: 2026 Trends)](https://coloruxlab.com/guides/mobile-app-color-design)
- *"Keep bold gradients in small areas like buttons or badges, not across the entire screen... two-color gradients often look basic — a modern trick is adding a middle stop that makes the transition smoother and richer."* [(UI Gradients: The Complete Guide)](https://www.onething.design/post/ui-gradients-the-complete-guide) [(Gradient Design: Inspiring Examples, Trends & Practical Tips)](https://www.designrush.com/agency/graphic-design/trends/gradient-design)

Applied to this app's real tokens, not invented ones:
- **Teal** (`#0A9FB0`) is the functional/active color — the sender's own bubble, the send button, active states. It should not wash the whole screen.
- **Magenta** (`#DC3E93`) is reserved as the rare "confirmation moment" accent — used in this plan specifically for the **read-receipt "seen" state** (a real milestone: your message was read), not as a default decoration.
- The existing 2-stop brand gradient (`#0A9FB0 → #DC3E93`) gets a middle stop using a color **already in the app's own palette** — `primary.bright` (`#22B8C9`) — for a richer, less "flat two-color CSS gradient" feel, without introducing a single new hex value: `linear-gradient(135deg, #0A9FB0 0%, #22B8C9 55%, #DC3E93 100%)`. Reserved for small, localized elements only (send button, avatar badges) — never a full-screen or large-surface wash, per the research above.
- Most of the chat screen (background, bubbles from the other party, input field) stays neutral — this is what makes the teal/magenta accents land as premium instead of loud.

**Chat lifecycle — industry practice, confirmed:** ride-hailing chat should be available during the active trip and become **read-only** (not deleted) once the trip ends — history kept for support/moderation, no new sends. [(Integrating In-App Chat in Ride-Hailing Platforms)](https://www.ridewyze.com/blog/integrating-in-app-chat-in-ride-hailing-platform)

**Rider/driver info asymmetry — this is Uber's actual documented policy, not a stylistic preference:** *"Drivers cannot see riders' last name, phone number, the rating riders give their driver, or their profile photo."* Riders, by contrast, *"can see the driver's first name, photo, and rating."* [(Driver Profiles — Uber Help)](https://help.uber.com/en/riders/article/driver-profiles) [(Privacy protection for riders — Uber Help)](https://help.uber.com/riders/article/privacy-protection-for-riders)

**Design tokens reference — pulled from the real, live `tailwind.config.ts` files, verified in both apps:**
- Primary teal: `#0A9FB0` (`primary.dark` `#087C89`, `primary.bright` `#22B8C9`, `primary.light` `#B8E9EE`, `primary.subtle` `#E4F8FA`)
- Secondary magenta: `#DC3E93` (light `#FBE0EE`)
- Brand gradient (small elements only): `linear-gradient(135deg, #0A9FB0 0%, #22B8C9 55%, #DC3E93 100%)`
- Neutrals — user app: background `#F5F7FF`, surface `#FFFFFF`, surface-2 `#F8FAFF`, border `#E8EEFF`
- Neutrals — driver app: bg `#F5F8FF`, surface `#FFFFFF`, surface-2 `#F0F4FD`, surface-3 `#E8EEFA`, border `#E2E8F0`
- Ink: primary `#0F172A`, secondary `#475569`, muted `#94A3B8`, inverse `#FFFFFF` (identical in both apps)
- Status: success `#10B981`, warning `#F59E0B`, error `#EF4444`, info `#0EA5E9` (identical in both apps)
- **Use Tailwind utility classes bound to these tokens where the app already has them** (`bg-primary`, `text-ink-primary`, `bg-surface-2`, etc. — the driver app's existing chat screens already mostly do this correctly) rather than raw inline hex strings — this is the real, legitimate consistency gap in the **user app's** chat screen specifically, which currently hardcodes hex values via inline `style={{}}` instead of using the equivalent utility classes other user-app screens use.

**Motion lens (per `design-motion-principles` skill):** this is a mobile app — weight **Jakub Krehel** (production polish) primary, **Emil Kowalski** (restraint/speed) secondary, **Jhey Tompkins** (delight) only for rare, low-frequency moments. Message send/receive happens often — keep those transitions fast and unobtrusive. `prefers-reduced-motion` mandatory throughout.

---

## Part A — Backend: lock chat once the ride ends

### Task 1: Reject new messages on a closed ride

**Files:**
- Modify: `api/src/modules/ride-chat/ride-chat.service.ts`
- Test: `api/tests/unit/ride-chat/ride-chat.service.test.ts`

Ride status enum (confirmed in `api/src/db/migrations/002_enums.sql` + later `ALTER TYPE` migrations): `'scheduled', 'requested', 'accepted', 'driver_arrived', 'in_progress', 'returning', 'completed', 'cancelled', 'no_drivers'`. Terminal (chat closes): `'completed'`, `'cancelled'`, `'no_drivers'`.

There's already an error code that fits exactly — `AppErrors.RIDE_INVALID_STATUS` (422, "This action is not allowed in the current ride status", in `api/src/constants/errors.ts`). No new error code needed.

- [ ] **Step 1: Write the failing tests**

In `api/tests/unit/ride-chat/ride-chat.service.test.ts`, add a second ride fixture near the top (after the existing `const RIDE = ...`):

```ts
const CLOSED_RIDE = { id: 1n, user_id: '5', driver_id: '9', status: 'completed' }
```

Then add this test inside the existing `describe('sendMessage', ...)` block (after the last `it(...)`):

```ts
  it('rejects sending on a ride that has ended', async () => {
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(CLOSED_RIDE as never)

    await expect(
      sendMessage(1n, { userId: 5n }, { body: 'hi', clientMsgId: 'c1' }),
    ).rejects.toMatchObject({ httpStatus: 422, appCode: 'RIDE_INVALID_STATUS' })
    expect(chatRepo.insertMessageIdempotent).not.toHaveBeenCalled()
  })
```

Add this new `describe` block at the end of the file, verifying read-only access still works after the ride ends (this is the behavior the fix must NOT break):

```ts
describe('getHistory on a closed ride', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(CLOSED_RIDE as never)
  })

  it('still returns message history after the ride has ended', async () => {
    vi.mocked(chatRepo.listMessages).mockResolvedValue([])

    await expect(getHistory(1n, { userId: 5n }, undefined)).resolves.toEqual([])
    expect(chatRepo.listMessages).toHaveBeenCalledWith(1n, undefined)
  })
})
```

Import `getHistory` alongside the other service imports at the top of the file (find the existing `import { sendMessage, getUnreadCount } from '@/modules/ride-chat/ride-chat.service'` line and add it):

```ts
import { sendMessage, getUnreadCount, getHistory } from '@/modules/ride-chat/ride-chat.service'
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `cd api && npx vitest run tests/unit/ride-chat/ride-chat.service.test.ts`
Expected: FAIL on "rejects sending on a ride that has ended" — `sendMessage` doesn't check status yet, so it proceeds and calls `insertMessageIdempotent`.

- [ ] **Step 3: Implement the status gate**

In `api/src/modules/ride-chat/ride-chat.service.ts`, add this constant near the top of the file (after the imports, before `interface ResolvedParticipant`):

```ts
// Once a ride reaches one of these, chat becomes read-only: history stays
// visible (getHistory/markRead still work), but no new messages can be sent.
// Matches the industry-standard pattern (chat lives with the trip, not
// forever) — see the plan doc for the research backing this list.
const CHAT_CLOSED_STATUSES = ['completed', 'cancelled', 'no_drivers']
```

Add a `status: string` field to the `ResolvedParticipant` interface:

```ts
interface ResolvedParticipant {
  senderType: RideParticipantType
  senderId: bigint
  recipientType: RideParticipantType
  recipientId: bigint | null
  status: string
}
```

In `resolveParticipant`, add `status: ride.status` to both returned objects:

```ts
  if (caller.userId !== undefined && String(ride.user_id) === String(caller.userId)) {
    return {
      senderType: 'user', senderId: caller.userId,
      recipientType: 'driver', recipientId: ride.driver_id === null ? null : BigInt(ride.driver_id),
      status: ride.status,
    }
  }
  if (caller.driverId !== undefined && ride.driver_id !== null && String(ride.driver_id) === String(caller.driverId)) {
    return {
      senderType: 'driver', senderId: caller.driverId,
      recipientType: 'user', recipientId: BigInt(ride.user_id),
      status: ride.status,
    }
  }
```

In `sendMessage`, add the gate right after `resolveParticipant` resolves, before the idempotent insert:

```ts
export async function sendMessage(
  rideId: bigint,
  caller: ChatCaller,
  input: { body: string; clientMsgId: string },
): Promise<RideMessageDTO> {
  const p = await resolveParticipant(rideId, caller)
  if (CHAT_CLOSED_STATUSES.includes(p.status)) {
    throw createHttpError(AppErrors.RIDE_INVALID_STATUS)
  }

  const { message, inserted } = await repo.insertMessageIdempotent({
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/unit/ride-chat/ride-chat.service.test.ts`
Expected: PASS (all cases, including the pre-existing ones — `RIDE` fixture's status is `'in_progress'`, not in `CHAT_CLOSED_STATUSES`, so existing send tests are unaffected).

- [ ] **Step 5: Commit**

```bash
git add api/src/modules/ride-chat/ride-chat.service.ts api/tests/unit/ride-chat/ride-chat.service.test.ts
git commit -m "feat(ride-chat): reject new messages once a ride reaches a terminal status"
```

---

### Task 2: Confirm no backend change needed for the frontend to know ride status

**Files:** none (research/confirmation only)

The frontend needs to know the ride's status to show a "chat ended" banner instead of the input bar. The user app already has `rideApi.getRide(rideId)` (used by the tracking page), which returns the full ride including `status` — reuse that, no new endpoint. The driver app already has the ride's `status` live in its Zustand store (`activeRide.status`, kept current by the existing `ride:status_update` socket handler in `App.tsx`) — also nothing new needed.

- [ ] **Step 1: Confirm**

Run: `grep -n "status" api/src/modules/rides/rides.types.ts` and confirm the ride response type includes `status` (it does — verified while writing this plan). No code changes for this task.

---

### Task 3: Backend verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full ride-chat suite + build**

Run: `cd api && npx vitest run tests/unit/ride-chat && npm run build`
Expected: all pass, build clean.

---

## Part B — User app: chat refinement (real brand, executed with restraint)

### Task 4: Refine the chat header, bubbles, and input using the real teal/magenta tokens with restraint

**Files:**
- Modify: `apps/user/app/(main)/ride/[id]/chat/page.tsx`

**Functional contract (fixed — the visual execution is what changes):**
- Header shows the **driver's real photo** (fallback: initials avatar using the existing brand gradient — unchanged, it was already correct: `linear-gradient(135deg, #0A9FB0, #DC3E93)`), the **driver's name**, and the **driver's rating** (star + number) as a subtitle. Riders seeing the driver's photo/name/rating matches the researched real-world policy.
- Fetch the driver's name/photo/rating and the ride's current status via `rideApi.getRide(rideId)` on mount (already returns `driver_name`, `driver_photo`, `driver_rating`, `status`).
- Listen for `ride:status_update` on the already-connected socket (same connection/room already joined) to react live if the ride ends while the user is in chat; update local status state when `data.status` is one of `'completed' | 'cancelled' | 'no_drivers'`.
- When ride status is terminal: hide the canned-reply chips and the input form; replace with a centered read-only banner: `"This ride has ended · Chat is read-only"`. Message history stays fully visible/scrollable above it.
- Everything else (send/receive, read receipts, canned replies while open, retry-on-fail, reconnect catch-up) keeps its exact current behavior.

**Design refinement to apply (real tokens — see research summary for the reasoning):**
- Header: stays neutral white (Surface `#FFFFFF`) with a bottom border — no teal wash. Driver name in `#0F172A` (ink-primary), rating in `#475569` (ink-secondary).
- Driver avatar fallback gradient: **unchanged** — `linear-gradient(135deg, #0A9FB0, #DC3E93)` was already correct; do not touch it.
- Message list background: neutral (`#F5F7FF`, the user app's real `background` token) — confirm the file's current value matches; if it's using a near-miss hex, correct it to this exact token value.
- **"Mine" (rider's own) bubble:** solid `#0A9FB0` (teal, the functional/active color), white text. Not a gradient — per the research, bold gradients stay in small localized elements (buttons, badges), not a repeated element that appears dozens of times per screen.
- **Other party's bubble:** neutral (`#F8FAFF` surface-2 or current equivalent), `1px solid #E8EEFF` border, `#0F172A` text — unchanged structurally.
- **Read-receipt ticks — the "confirmation moment" detail:** unsent/sending = `#94A3B8` (ink-muted); sent-but-unread = `#0A9FB0` (teal, functional); **read/seen = `#DC3E93` (magenta)** — this is the one deliberate use of the accent color as a milestone marker, per the research principle that magenta should mark confirmation states, not decorate defaults.
- Failed-message retry text: `#EF4444` (error status color).
- Canned-reply chips: neutral surface background, `1px solid` border, `#475569` text, full pill shape — quick-action chips, not "selected" state, so they stay neutral, not teal-filled.
- Input field: neutral surface-2 background, `1px solid #E8EEFF` border, `20px` radius.
- **Send button:** full pill shape (user-app convention), the enriched 3-stop brand gradient `linear-gradient(135deg, #0A9FB0 0%, #22B8C9 55%, #DC3E93 100%)`, white icon. This is the one place in the redesign where the full gradient appears — small, localized, and it's the primary action, exactly matching the research's "gradients belong on buttons and badges."
- Read-only banner (ride ended): info pill — `#E0F2FE` background, `#0EA5E9` text, centered, full-pill shape, positioned where the input bar was.
- Use Tailwind utility classes bound to the real tokens (`bg-primary`, `text-ink-secondary`, `bg-surface-2`, etc.) where they already exist in this app, rather than the raw inline hex strings the file currently uses — this is the actual, legitimate consistency fix here (not a color-value change, a styling-approach one).

**Motion (Jakub-primary/Emil-secondary lens):**
- Message bubble entrance: fast, unobtrusive (150-220ms) — this fires on every message, a frequent interaction.
- Send button tap: existing `whileTap={{ scale: 0.9 }}` is fine, keep it.
- Read-only banner appearing (rare — once per chat session at most): a more noticeable fade/slide-in (250-300ms) is appropriate here, unlike the per-message bubble animation.
- `prefers-reduced-motion` respected throughout, no exceptions.

- [ ] **Step 1: Invoke the design skills**

Invoke `apps/user:design-taste-frontend`, `impeccable`, and `design-motion-principles` (Create mode) before writing the JSX. Give them this task's functional contract, the corrected token guidance above, and the motion guidance as the brief — the values above are fixed (they're the app's real brand), not suggestions to override. If `impeccable` flags these teal/magenta values as "outside DESIGN.md," that's the known stale-doc false positive documented in this plan's research summary — do not let the hook override the real, verified `tailwind.config.ts` values.

- [ ] **Step 2: Implement**

Refine the header, message bubble styles, canned-reply chips, input bar, and add the ride-status fetch + live update + read-only banner, per the contract and tokens above. Reuse the existing `rideApi.getRide` method.

- [ ] **Step 3: Typecheck**

Run: `cd apps/user && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `cd apps/user && pnpm dev`. Open an active ride's chat: confirm the header, bubbles, canned replies, and input match the refined tokens above (teal for mine/functional, magenta only on the read-receipt "seen" state and the send-button gradient, everything else neutral). Confirm sending/receiving/read-receipts still work exactly as before. Then verify against a ride whose status is terminal (see Open Questions below for how): confirm the input/canned-replies are replaced by the read-only banner, with message history still visible.

- [ ] **Step 5: Commit**

```bash
git add "apps/user/app/(main)/ride/[id]/chat/page.tsx"
git commit -m "refine(user): chat screen restraint pass on the real brand tokens, add read-only state after ride ends"
```

---

## Part C — Driver app: chat refinement (with privacy asymmetry)

### Task 5: Refine the chat header (generic avatar, name, NO rating), bubbles, and input

**Files:**
- Modify: `apps/driver/src/pages/ActiveRide/RideChat.tsx`

**Functional contract (fixed):**
- Header shows a **generic initials avatar only** (brand gradient, rider's initials from `activeRide.userName`) and the **rider's name**. **Never** a real photo, **never** a rating — matches the researched real Uber policy. Confirmed while researching this plan: `apps/driver/src/store/useRideStore.ts`'s `ActiveRide` interface has no `userPhoto` field at all today — do not add one; `userRating` exists on the store but must not be rendered in this header.
- Ride status for the read-only gate comes from `activeRide?.status` — already live-updated by the existing `App.tsx` socket handler, no new fetch or socket listener needed here.
- When `activeRide?.status` is terminal: hide the canned-reply chips and input form, replace with the same read-only banner pattern as the user app. Message history stays visible.
- Everything else (send/receive, read receipts, canned replies, retry, reconnect catch-up, the existing `chat:open`/`chat:close` emits and unread-badge-clear-on-open/leave) keeps its exact current behavior.

**Design refinement to apply** — same real teal/magenta tokens and restraint principles as Task 4, adapted to driver-app shapes:
- The driver app's chat screen (unlike the user app's) already mostly uses the correct Tailwind utility classes (`bg-primary`, `text-text-secondary`, `bg-surface-3`, `border-border`) rather than raw hex — confirm this is still the case and keep that pattern; the fix here is the same restraint/token-value refinement as Task 4 (teal for functional/mine, magenta reserved for the "seen" read-receipt only, neutral everything else), not a switch away from utility classes.
- Send button: `24px` rounded (driver-app convention, not pill), enriched 3-stop brand gradient `linear-gradient(135deg, #0A9FB0 0%, #22B8C9 55%, #DC3E93 100%)`, white icon.
- Read receipts: sent-but-unread = teal (`bg-primary` equivalent), read/seen = magenta `#DC3E93` (the same "confirmation moment" detail as Task 4 — this is a new accent for the driver app, add it as a one-off value since the driver app has no named magenta token; do not add a new Tailwind config entry for a single use, per this codebase's own YAGNI conventions).
- Canned-reply chips, input field, other-party bubble: neutral, following the same restraint principle as Task 4.
- Read-only banner: info-colored (`#E0F2FE`/`#0EA5E9` — or the driver app's equivalent `accent.blue`/light variant if one exists closer to that semantic; check the driver tailwind config for an existing info-style token before introducing the raw hex).

**Motion:** same Jakub-primary/Emil-secondary lens and frequency-gate reasoning as Task 4.

- [ ] **Step 1: Invoke the design skills**

Invoke `design-taste-frontend`, `impeccable`, and `design-motion-principles` (Create mode) — unscoped variants, driver app. Give them this task's functional contract and the corrected token guidance as the brief.

- [ ] **Step 2: Implement**

Refine the header (generic avatar + name only, no rating, no photo), message bubbles, canned-reply chips, input bar (rounded-2xl send button), and add the `activeRide?.status`-driven read-only banner, per the contract and tokens above.

- [ ] **Step 3: Typecheck**

Run: `cd apps/driver && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `cd apps/driver && pnpm dev`. Open an active ride's chat from both `NavigateToPickup` and `TripInProgress`: confirm the header shows only an initials avatar (no real photo — there is none in the store) and the rider's name, with **no rating visible anywhere**. Confirm the "seen" read-receipt uses magenta, send button is rounded-2xl with the 3-stop gradient. Confirm send/receive/canned-replies still work. Then verify the read-only banner appears once the ride reaches a terminal status, with history still visible.

- [ ] **Step 5: Commit**

```bash
git add apps/driver/src/pages/ActiveRide/RideChat.tsx
git commit -m "refine(driver): chat screen restraint pass on the real brand tokens, hide rider rating/photo, add read-only state after ride ends"
```

---

## Part D — Final verification

### Task 6: Cross-app verification gate

**Files:** none (verification only)

- [ ] **Step 1: API suite + build**

Run: `cd api && npx vitest run tests/unit/ride-chat && npm run build`
Expected: all pass, build clean.

- [ ] **Step 2: User + driver typecheck**

Run: `cd apps/user && npx tsc --noEmit` and `cd apps/driver && npx tsc --noEmit`
Expected: no errors in either.

---

## Self-Review notes (carried into the plan)

- **Spec coverage:** chat cutoff on ride end (T1, backend-enforced; T4/T5 add matching frontend UI), rider sees driver photo/name/rating (T4), driver never sees rider rating/photo (T5, verified against the store's actual fields), premium execution of the **real** brand (T4/T5, corrected from an earlier draft's wrong assumption — grounded in the actual `tailwind.config.ts`, not the stale `DESIGN.md`), smooth non-laggy animation (motion guidance in T4/T5), Uber/Ola/Rapido-style placement (already matches this app's existing pattern — the ask was about the destination screen's visual quality, addressed by the refinement). All covered.
- **TDD:** the one piece of new logic with a real branch (T1's status gate) is test-first. Frontend has no unit tests, matching this repo's established convention — verified manually instead.
- **Type consistency:** `CHAT_CLOSED_STATUSES` (T1) used only in `ride-chat.service.ts`; `ResolvedParticipant.status` is the single new field, consumed only by `sendMessage`'s new check — `getHistory`/`markRead` unchanged, verified by T1's own test.

## Open questions / risks flagged

1. **Manually testing the terminal-ride read-only banner (T4/T5 Step 4)** requires a ride already in a closed status with a reachable chat screen. Since the chat button today only lives on active-ride screens, the implementer may need to hit the API directly (e.g. a throwaway test ride, or updating a ride's status via `psql`) to verify the banner rather than relying on normal app navigation. Doesn't block the backend enforcement (T1's tests prove that independently).
2. **`no_drivers` in `CHAT_CLOSED_STATUSES`:** included for completeness, but a ride with no drivers matched never had a `driver_id`, so chat was likely never reachable for it anyway. Harmless to include.
3. **Driver app's magenta "seen" accent (T5)** is a one-off raw hex value since the driver app has no named magenta/secondary brand token today, unlike the user app. Adding a new Tailwind token for a single use would be over-engineering per this codebase's own conventions — flagging so it's a deliberate choice, not an oversight.
