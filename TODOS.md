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
