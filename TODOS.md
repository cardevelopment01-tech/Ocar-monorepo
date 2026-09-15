# TODOS

## Mobile

### Set up jest-expo + React Native Testing Library for screen-level tests

**What:** Install `jest-expo` + React Native Testing Library and write component/E2E tests for the rider/driver mobile apps' screens (auth flow first, then booking/tracking as those land).

**Why:** `packages/mobile-shared`'s pure logic (JWT expiry, error mapping, secure-storage routing) got unit tests via `vitest` in Days 3-4, but screen-level RN components have zero automated coverage — only manual verification checkpoints (TalkBack pass, device testing). That doesn't scale once screen count grows past Days 5-10's map/booking/tracking flows.

**Context:** Surfaced during the Days 3-4 `/plan-eng-review` (issue 3A) for `docs/superpowers/plans/2026-09-15-react-native-expo-mobile-android-first-spec.md` Section 7.1. Deferred rather than built immediately since the auth-screen scope alone doesn't justify the setup cost yet; the natural trigger point is the start of Days 5-7, when the rider booking flow roughly doubles the screen count and manual-only verification starts being a real bottleneck.

**Effort:** M
**Priority:** P2
**Depends on:** None
