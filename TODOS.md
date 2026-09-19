# TODOS

## Mobile

### Set up jest-expo + React Native Testing Library for screen-level tests

**What:** Install `jest-expo` + React Native Testing Library and write component/E2E tests for the rider/driver mobile apps' screens (auth flow first, then booking/tracking as those land).

**Why:** `packages/mobile-shared`'s pure logic (JWT expiry, error mapping, secure-storage routing) got unit tests via `vitest` in Days 3-4, but screen-level RN components have zero automated coverage — only manual verification checkpoints (TalkBack pass, device testing). That doesn't scale once screen count grows past Days 5-10's map/booking/tracking flows.

**Context:** Surfaced during the Days 3-4 `/plan-eng-review` (issue 3A) for `docs/superpowers/plans/2026-09-15-react-native-expo-mobile-android-first-spec.md` Section 7.1. Deferred rather than built immediately since the auth-screen scope alone doesn't justify the setup cost yet; the natural trigger point is the start of Days 5-7, when the rider booking flow roughly doubles the screen count and manual-only verification starts being a real bottleneck.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Lightweight foreground poll fallback for missed driver ride-requests

**What:** Poll a pending-request endpoint every N seconds while a driver is online and the app is foregrounded, as a partial mitigation for `ride:request` socket events missed due to a silent socket drop (not a full app kill — that case is FCM's job).

**Why:** Days 8-10 accepted a known gap (no FCM yet — `google-services.json` unavailable) where a ride request can be missed if the driver's socket disconnects without a clean reconnect. A server-side metric (added in the Days 8-10 CEO review, Section 8) now gives visibility into how often this actually happens; a poll would close part of the gap cheaply in the meantime, but wasn't built immediately since it adds a second delivery path to maintain for a gap Days 13-14 will close properly with real push.

**Pros:** Nearly free (foreground-only, no battery cost), partially closes a real reliability gap before Days 13-14 lands.

**Cons:** Doesn't help the backgrounded/killed case at all (still needs FCM); adds a second delivery path (poll + socket) to reason about and keep in sync.

**Context:** Surfaced during the Days 8-10 `/autoplan` CEO review (`docs/superpowers/plans/2026-09-17-days-8-10-driver-booking-flow.md`) as a cherry-pick candidate, deferred in favor of the cheaper visibility metric. Natural trigger point: if that metric shows missed-request volume is non-trivial before Days 13-14 ships FCM.

**Effort:** S
**Priority:** P3
**Depends on:** None (informed by the Section 8 metric's data, not blocked by it)

### Confirm speed_alert_log delivery mechanism before building driver-mobile's speed-alert surface

**What:** Determine whether `speed_alert_log` events reach the client via a socket push or only ever via REST poll, before building driver-mobile's speed-alert UI in the post-Day-10 ride-flow hardening plan's Stage 4.

**Why:** Web driver's `useSpeedAlert.ts` surfaces speed alerts somehow, but a grep of `api/src/websocket/socket.server.ts` during the 2026-09-19 `/plan-eng-review` of `docs/superpowers/specs/2026-09-19-post-day10-ride-flow-hardening-design.md` found no `speed_alert` socket emit anywhere. Building driver-mobile's speed-alert surface against an assumed push that doesn't exist would ship a silently-broken feature (no alert ever fires, no error either).

**Context:** Surfaced during that review's backend-contract verification pass, alongside two other checks (driver-cancel endpoint, `returning` status socket push, `stop:added` event) that turned out to already exist — this is the one item that check could not confirm either way. Read `useSpeedAlert.ts` (web driver) directly to see how it actually gets data before assuming either mechanism.

**Effort:** XS (a few minutes of reading, not new code)
**Priority:** P2 — blocks Stage 4's speed-alert component specifically, not the rest of the plan
**Depends on:** None

### Wire packages/mobile-shared's new jest-expo test:ui into CI

**What:** `turbo.json`'s `test` task doesn't include the `test:ui` script Stage 0 added to `packages/mobile-shared` (jest-expo + RTL component tests), and `.github/workflows/ci.yml` has no job touching `packages/mobile-shared` or either mobile app at all. Either alias/rename `test:ui` into the existing `test` task turbo already runs, or add a dedicated CI job.

**Why:** Stage 0 (post-Day-10 ride-flow hardening) spent three implementer dispatches getting this test harness right (RTL v14's async `render()`/`fireEvent()` API, `react-test-renderer` incompatibility) specifically so `SOSButton`/`CancelSheet` — safety-critical and policy-critical components — have real component tests. None of those 18 tests currently run anywhere except a developer's own machine; they'll silently rot the first time someone changes a token or a prop shape and nobody notices until it ships broken.

**Context:** Surfaced during Stage 0's final whole-branch review (`docs/superpowers/plans/2026-09-20-post-day10-stage0-shared-infra.md`), explicitly flagged by the reviewer as "arguably outside Stage 0's declared scope" and deferred here rather than fixed inline, since it's a project-wide CI/turbo decision, not a Stage-0 component bug.

**Effort:** S
**Priority:** P2
**Depends on:** None
