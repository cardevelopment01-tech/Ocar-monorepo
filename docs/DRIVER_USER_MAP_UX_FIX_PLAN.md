# Driver & User App — Map/Nav Correctness + UX Fix Plan

**Date:** 2026-07-12
**Status:** Draft, phase 0 not started
**Scope:** the 13 bugs reported against user-app tracking, driver-app nav, and driver homepage
**Related docs:** [`NAVIGATION_PHASE5_FINAL_HARDENING_PLAN.md`](./NAVIGATION_PHASE5_FINAL_HARDENING_PLAN.md) (broader nav feature roadmap — trip share, canned messages, geofence; this doc does not duplicate it), [`MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md`](./MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md) (earlier audit)

---

## 0. A finding before the plan: docs and code disagree

`NAVIGATION_PHASE5_FINAL_HARDENING_PLAN.md` §3 states *"the bearing-gated heading fix shipped; escalate only if Phase 5 drives show it's insufficient."* Reading the actual code (`apps/user/lib/useInterpolatedPosition.ts:72-75`, `apps/driver/src/lib/useDriverLocation.ts`) found **no speed gate and no deadband** — heading is recomputed from raw-fix bearing whenever two fixes are >8m apart, which GPS jitter alone defeats. Three real-device screenshots (analyzed below) confirm the marker still spins/misaligns in production.

Lesson adopted from that same doc's Phase 5 (real-device verification as a blocking gate, not a checkbox): **this plan closes with the same kind of drive/device verification, not a desk review**, because that's evidently the only thing that has previously separated "code complete" from "actually fixed" in this codebase.

---

## 1. Visual evidence

Three screenshots from a real test ride (driver app, Bhubaneswar), analyzed directly:

| # | Screen | What it shows |
|---|---|---|
| 1 | Heading-to-pickup | Car marker ~6% of screen height (Uber-class apps run roughly half that); map is only **~28-30%** of vertical screen space — top instruction stack (~19%) + bottom rider/action stack (~40%) + browser/system chrome (~20%) crowd it out |
| 2 | Trip-in-progress, mid-transition | A grey-scrimmed sheet with a red "!" icon is visible **peeking out from behind** the bright, undimmed "Complete Trip" sheet — confirming the SOS confirm sheet is losing a z-index/stacking fight against a later-mounted sheet. It's not just "hard to see" — it is non-interactive, sitting under another sheet. Worst possible failure mode for a safety control. |
| 3 | Trip-in-progress, settled | Car marker sits well left of the blue route line, over a building footprint, and points **straight up while the actual road runs ~45°** — the marker isn't just noisy, it sometimes doesn't rotate to the road at all. Map is ~38-40% of screen. A stray unlabeled arrow button (icon-identical to the "open external nav" button from the pickup screen) floats orphaned bottom-left, colliding with a map label. Hindi instruction text is clipped mid-word, bleeding past its card edge. |

This upgrades two items from the prior investigation:
- **Heading is not just jittery — it can fail to track the road bearing at all** (image 3). The fix in Phase 2 must cover both.
- **The SOS bug is a stacking-order defect with evidence of exact failure**, not a vague visibility complaint — Phase 1 targets the precise cause.

---

## 2. Principles governing every phase

*(per project convention — [`andrej-karpathy-skills:karpathy-guidelines`](../CLAUDE.md), applied here explicitly since this plan spans two apps + API)*

- **Root cause, not symptom.** Every phase below traces to one of 5 shared root causes (§3), not 13 independent patches. Fix the shared function/hook, not each call site.
- **Surgical diffs.** Touch only the files listed per phase. No opportunistic refactors of adjacent code.
- **No speculative infra.** No new shared `packages/` module, no self-hosted map-matching service, no native app rewrite — matches this repo's own "still NOT building" list in the Phase 5 doc. Reuse `apps/driver/src/lib/geo.ts`'s existing `nearestPointOnPolyline()` rather than inventing a new algorithm.
- **Verifiable success criteria per phase**, stated as pass/fail checks a reviewer can actually run — not "looks better."
- **Production-grade decisions, cited.** Where a fix follows an established industry pattern (heading gating, presence TTL, z-index scale, camera framing), the pattern is named so the "why" survives past this doc.

---

## 3. Root causes → phases

| Root cause | Bugs it explains | Phase |
|---|---|---|
| SOS sheet loses the stacking order to a later-mounted sheet | Driver#8 | **Phase 1** |
| No road/route snapping; raw GPS drawn directly | User#1 (partial), User#2, Driver#5, Customer#2, Customer#3 | **Phase 2** |
| No speed gate/deadband on heading; heading sometimes not applied at all | User#1 | **Phase 2** |
| ETA/distance only refresh on reroute triggers, frozen between | User#3, Customer#5 | **Phase 3** |
| Client-authoritative driver presence, no heartbeat/TTL | Driver#4, Customer#4 | **Phase 3** |
| Nav chrome not built for glanceability (camera, viewport, marker size, icon collisions, text overflow) | Driver#5,6,7, Customer#1,3 | **Phase 4** |
| Driver homepage layout not mobile-ergonomic | Driver#1,2,3 | **Phase 5** |
| Off-route/snap gate is distance-only (no bearing check); step-advance has no self-heal | Driver#9 (new, 2026-07-13 field test) | **Phase 9** |

Phases 1-3 are backend/logic-heavy and independent of each other — can run in parallel. Phase 4 depends on Phase 2 (camera framing needs a stable, snapped heading to follow). Phase 5 is fully independent. Phase 6 is the closing gate for all of them.

---

## Phase 1 — P0: SOS stacking fix (safety-critical) — ✅ done 2026-07-12

**Root cause found (more precise than the original hypothesis):** SOSButton's confirm sheet was a plain `fixed` div nested inside `TripInProgress.tsx`/`NavigateToPickup.tsx`'s `overflow-hidden`, `height: 100dvh` screen shell. That container/positioning combination is a known source of unreliable `position: fixed` stacking on mobile browsers — and this codebase had already worked around the identical problem twice before (`DatePickerSheet.tsx`, `SelectSheet.tsx` both portal to `document.body` for this exact reason). SOSButton just hadn't gotten the same treatment.

**Fix shipped:** `SOSButton.tsx` now renders its confirm sheet via `createPortal(..., document.body)`, matching the existing codebase pattern, and uses a new shared `Z_SOS_MODAL = 150` constant (`apps/driver/src/lib/constants.ts`) — deliberately above every other z-index in the app (previous max was `NotificationToast` at 130) so a safety escalation can never lose a stacking fight. Checked for real collisions: `TripRequestCard` is the only element above the old value at `z-[200]`, but it only mounts while the driver is idle/awaiting a ride, never during an active trip alongside SOS — no actual conflict, left untouched (surgical scope, no repo-wide z-index rewrite).

`tsc --noEmit` clean. Still needs the real-device pass in Phase 6 — the portal fix is spec-solid, but this exact bug class (mobile-browser stacking quirks) is precisely why device verification is a blocking gate in this plan, not a desk sign-off.

**Why P0 despite being small:** a safety control that silently fails to open is the single highest-severity item in this list, regardless of engineering effort. Production teams triage by blast-radius-if-wrong, not by size.

**Decision:** define one semantic z-index scale for the driver app (`dropdown < sticky < modal-backdrop < modal < toast`) instead of bumping `SOSButton.tsx` to `z-[999]` in isolation — a point fix would just move the collision to the next sheet that gets added later. Root-cause fix per the karpathy guideline above.

**Build:**
- Audit every fixed-position sheet on `NavigateToPickup.tsx`, `TripInProgress.tsx`, `Home.tsx`, `OTPVerify.tsx` for their current z-index values.
- Introduce a shared scale (constants, not a new component library) and reassign every fixed/sheet element to it. SOS confirm sheet gets the `modal` tier; the trip-completion sheet, which currently outranks it, moves to whatever tier it actually belongs at (likely also `modal`, in which case mount order / a shared "active sheet" stack becomes the tiebreaker rather than two sheets being simultaneously open).
- Confirm only one modal-tier sheet can be visually active at a time (if the trip-complete sheet and SOS sheet can legitimately both be triggered, the SOS sheet must win — a safety escalation should never be blocked by a checkout-style action sheet).

**Files:** `apps/driver/src/components/ui/SOSButton.tsx`, `NavigateToPickup.tsx`, `TripInProgress.tsx`, `Home.tsx`, `OTPVerify.tsx`.

**Review checklist:**
- [ ] Trigger SOS from all 4 screens; sheet is fully visible, undimmed, and interactive every time
- [ ] Trigger SOS while the trip-complete sheet is open; SOS wins
- [ ] No other sheet/toast in the app now silently renders behind another (spot-check the notification toast and the offline-confirm sheet on `Home.tsx`)

**Effort:** Small (1 day).

---

## Phase 2 — P0: Route-accurate marker + stable heading — ✅ done 2026-07-12

**Found the codebase already had more of this than the original investigation credited:** `useTurnByTurn.ts` was already calling `nearestPointOnPolyline()` every GPS tick for off-route detection — the snapped point already existed in memory, it just was never used for rendering. And `SelfCarMarker` deliberately doesn't self-rotate on the driver nav screens (a comment already documents this — the map rotates via `RecenterMap`'s heading-up camera instead, to avoid double-rotation). So image 3's "car pointing straight up on a diagonal road" wasn't a missing-rotation bug, it was the *camera's* heading input (`selfHeading`, derived from raw jittery fixes) being wrong — fixing position snapping and camera heading together closes it.

**Fix shipped:**
- `useTurnByTurn.ts` now exposes `snappedPosition`/`snappedHeading` — the existing `nearestPointOnPolyline()` result's point, plus the bearing of its matched segment (`bearingDeg` between the segment's two endpoints), whenever within the existing `OFF_ROUTE_THRESHOLD_METRES` (40m) corridor; both null outside it. No new thresholds — reused the off-route-detection constant that already meant "close enough to trust this route line."
- `NavigateToPickup.tsx` and `TripInProgress.tsx` now feed the marker, map center, and `RecenterMap`'s heading from `snappedPosition ?? position` / `snappedHeading ?? selfHeading`, falling back to raw GPS exactly when off-route (which is also exactly when trusting the route line would be wrong). Raw `position` is still used unchanged for arrival/distance math — snapping is a display concern only.
- User app (`apps/user`) had no route-matching utility at all — ported `nearestPointOnPolyline`/`bearingDeg`/`haversineMetres` into a new `apps/user/lib/geo.ts` (matches this repo's existing per-app-duplication convention, no new shared package). `useInterpolatedPosition.ts` now accepts an optional decoded `routePoints` array and snaps its RAF animation target + heading the same way as the driver side, using the same 40m corridor for cross-app consistency. `ride/[id]/page.tsx` decodes `encodedPolyline` via `useMemo` and passes it through.

`tsc --noEmit` clean on both `apps/driver` and `apps/user`.

**Decision — snapping tier:** production apps use HMM map-matching against a road graph (Newson & Krumm's 2009 algorithm, what OSRM/Valhalla/Google Roads API implement) for road-accurate positioning. This stack has no road-graph service and adding one is exactly the kind of infra the existing docs correctly decline elsewhere ("self-hosted routing engine... ops burden is not [worth it] for 3 corridors"). The pragmatic, already-available substitute: **snap to the already-fetched Directions polyline** using `nearestPointOnPolyline()` (`apps/driver/src/lib/geo.ts:32-72`), which already does the correct flat-plane-with-latitude-correction projection. This directly explains image 3 (car floating off the route, near a building) — the marker currently renders the raw fix, never the polyline-projected one.

**Decision — heading:** industry pattern is a heading source priority (device/GPS course when moving, computed bearing as fallback, frozen when stationary) plus a deadband and shortest-arc slew limit, and — once snapping exists — preferring the matched road segment's bearing over raw-fix bearing. This is *why* image 3 shows the marker facing the wrong way entirely: raw bearing between two jittery fixes can point anywhere; a snapped segment can only point along the road.

**Build:**
1. Port `nearestPointOnPolyline`/`bearingDeg`/`haversineMetres` into `apps/user/lib/geo.ts` (new file, matches the existing per-app duplication pattern in this repo — no shared package).
2. In `useInterpolatedPosition.ts` (user) and `useDriverLocation.ts` (driver): when a route polyline exists and the raw fix is within a ~35m corridor of it, animate toward the **snapped point** and use the **matched segment's bearing** for heading. Outside the corridor, fall back to raw GPS (doubles as the existing deviation/reroute signal).
3. Add a heading deadband (~8°) and ignore fixes with `coords.accuracy` worse than ~25-30m where available.
4. Animate *along* the polyline (interpolate by distance/segment, not a straight lerp between two raw points) so the marker travels the road shape through corners instead of cutting a diagonal.
5. `lerpAngle` itself is correct — verified by reading it, shortest-arc normalization is already right. Do not touch it.

**Files:** `apps/user/lib/useInterpolatedPosition.ts`, `apps/user/lib/geo.ts` (new), `apps/driver/src/lib/useDriverLocation.ts`, `apps/driver/src/lib/geo.ts` (wire the existing util in, currently only used for progress/deviation math).

**Review checklist:**
- [ ] Replay/drive a route with at least 2 turns; marker stays on the road line through both
- [ ] Marker heading always points along the direction of travel, never perpendicular or reversed (the image-3 failure)
- [ ] No visible flip-flopping in heading while stationary or moving <2 m/s
- [ ] Deviation/reroute triggers still fire correctly when actually off-route (this logic is reused, not replaced)

**Effort:** Medium (2-3 days + the drive verification in Phase 6).

---

## Phase 3 — P1: Live ETA + server-authoritative presence

Two independent backend-leaning fixes, bundled because both replace a client-side heuristic with a small piece of server truth.

### 3a. Ticking ETA (User#3, Customer#5)

**Decision:** two-tier ETA — server refresh stays the accurate tier (unchanged), a 1s client-side countdown fills the gap between refreshes, derived from Phase 2's along-route remaining distance ÷ smoothed recent speed, eased (not jumped) against each server refresh. This is the standard pattern behind why Uber/Ola ETAs visibly count down instead of sitting frozen for a minute.

**Files:** `apps/user/app/(main)/ride/[id]/page.tsx` (L207, L440-476, L582-585). Don't touch the existing fetch/trigger logic.

**3a status: ✅ done 2026-07-12.** `ride/[id]/page.tsx` now tracks `liveEtaAt` alongside `liveEta` and ticks a derived `displayEta` down every second (rate implied by the server's own `distanceKm/etaMin`, clamped at 0), reset on each real server refresh. `tsc --noEmit` clean.

### 3b. Presence/reload reliability (Driver#4, Customer#4) — ✅ done 2026-07-12, revised from the original plan

**What actually turned out to be true (this plan section was written before reading the real code — corrected here per the karpathy-guidelines rule to surface confusion/re-derive rather than blindly implement a stale plan):**

- `socket.server.ts` already had a 45s disconnect-grace timer before marking a session offline — not the "client-Zustand-flag-is-the-only-truth" situation originally assumed. That's a reasonable, already-industrial pattern (Socket.io's own ping/pong is the heartbeat; the grace window absorbs reconnects).
- `App.tsx`'s reload restore already re-fetches session + active-ride state from the server on every mount — also more mature than assumed.
- `cleanup.worker.ts`'s 30-min auto-cancel is **not silent** — it already flags at 10 min and emits `sendStuckRideFlagged` to both the ride room and `admin:ops` before ever cancelling at 30 min. A reasonable staged escalation already exists; no changes needed there.

**The actual bug**, found by tracing the real reload path end to end: the disconnect-grace timer's SQL flipped **`on_trip`** sessions offline on the same 45s timer as idle `online` ones (`WHERE status IN ('online', 'on_trip')`). A driver mid-trip who loses connectivity for a bit (tunnel, dead zone, phone reboot — or just closing the browser "and reopening again," exactly as reported) had their session status flipped to `offline` after 45s even though the ride was still genuinely in progress. On reload, `App.tsx`'s restore logic only ever called `getActiveRide()` inside the `session.status === 'on_trip'` branch — so a session that had drifted to `offline` skipped that check entirely and unconditionally called `clearRide()`, silently dropping a still-live ride from the driver's screen while the rider's app kept waiting on it. This is the precise mechanism behind the report ("driver app goes offline even after accepting a ride and then the ride won't show and user app still shows the ride unless cancelled").

**Fix shipped (two small, surgical changes — no new Redis/TTL infra needed, the existing mechanisms were already adequate once this interaction bug was closed):**
- `socket.server.ts`: the disconnect-grace SQL now only auto-offlines `status = 'online'` sessions, never `on_trip`. Whether an on-trip driver has truly gone dark is judged by GPS-heartbeat continuity via `cleanup.worker.ts`'s existing stuck-ride sweep, not by a bare socket blip.
- `App.tsx`: `restoreSessionOnce` now calls `getActiveRide()` unconditionally (whenever a session exists) instead of only when `session.status === 'on_trip'`, and restores the ride whenever the server confirms one exists — regardless of what the session status drifted to. The ride row is server truth here; the session flag isn't.

**Files touched:** `api/src/websocket/socket.server.ts`, `apps/driver/src/App.tsx`. (`useSessionStore.ts` and `cleanup.worker.ts` needed no changes — struck from the original file list.)

`tsc --noEmit` clean on `apps/driver` and `api`.

**Review checklist:**
- [ ] ETA visibly ticks every second on the tracking screen, doesn't freeze between refreshes, doesn't jump discontinuously when a server refresh lands
- [ ] Kill the driver browser mid-ride: presence flips offline within ~15-30s (not 30 min), and the ride is **not** silently cancelled — an ops alert fires instead
- [ ] Normal network blip (airplane mode 5s) does not flip the driver offline or drop the ride

**Effort:** Medium (2-3 days).

---

## Phase 4 — P1: Nav camera, viewport chrome, and the small polish items image 3 surfaced — partially done 2026-07-12

**Reality check before implementing (per karpathy-guidelines — read before coding, don't blindly execute a stale plan):** the driver app's `RecenterMap.tsx` turned out to already be a fully-built, production-quality eased heading-up follow camera — smoothed heading/pitch/zoom animation, distance-based dynamic zoom (`zoomForDistance`), drag-to-pause/re-center, padded-center offset so the marker sits toward the bottom of the viewport for look-ahead. None of that needed building. Two of the five screenshot findings also didn't survive a code check: `ManeuverBanner.tsx` already truncates correctly (`truncate` + `min-w-0`) — the "पर…" was a working ellipsis, not clipped text, and the "text bleeding past the edge" / label collisions were Google's own map tile labels, not app UI, and not something CSS here controls. Recording this so the same phantom fix doesn't get attempted again.

**What was real, and fixed:**
- **Marker size** (Driver#6, screenshot-confirmed oversized): `SelfCarMarker.tsx` and `CarMarker.tsx` both shrunk from 32×52 to 22×36 (~30%, per the plan).
- **Route/marker color parity** (Customer#1): `apps/user/components/map/RoutePolyline.tsx`'s default variant recolored from navy (`#1a1a2e`, 8/4.5px) to match the driver app's blue (`#1A73E8`, 11/7px casing) exactly. The user app's `pickup-leg` variant (a dashed-grey style with no driver-app equivalent) was left alone.
- **A more consequential bug than the plan anticipated, found while wiring the zoom fix below:** the user app's `RecenterMap.tsx` was rotating the *entire map* via `heading`/`map.setHeading()` on the ride-tracking screen, at the same time `CarMarker.tsx` was *also* self-rotating its own icon by the same heading. That's a double-rotation — the exact bug class the driver app's `SelfCarMarker.tsx` has an explicit code comment warning about, just never applied on the user side. Two things spinning by the same jittery heading value simultaneously is a very plausible primary cause of "heading rotating indefinitely" (User#1), on top of the raw-GPS-jitter cause already addressed in Phase 2. Fix: `RideMapScene.tsx` no longer passes `heading`/`headingKnown` to `RecenterMap` — the map stays north-up (correct pattern for a passenger view; only the driver's own nav screens should be heading-up) and `CarMarker`'s own rotation is the sole indicator, matching how the map already behaved on `HomeMapScene.tsx` (which never passed heading to begin with).
- **Initial/ongoing zoom too wide** (Customer#3, and possibly a contributor to Customer#2's "polyline not rendering" — a route can look invisible at city-level zoom): `RideMapScene.tsx` was switching straight from a fitBounds view to a pure pan-only `RecenterMap` the moment a driver position arrived, at whatever zoom (initial static 13) happened to be active, and never touching zoom again for the rest of the trip. Ported the driver app's own validated "overview beat, then follow" pattern (`OVERVIEW_BEAT_MS = 1200`, matching `NavigateToPickup.tsx`'s `mapMode`): a brief `FitBounds([driverPos, legTarget])` re-fit whenever the leg changes or a driver position first appears for that leg, then settles into plain follow.

**Deliberately not done in this pass — needs a running dev server, not blind edits:** the top-instruction-card / bottom-sheet chrome density itself (screenshots measured map at only ~28-40% of viewport). The driver app's camera system computes `topPadding`/`bottomPadding` (100/220 on both nav screens) to frame the marker correctly *around* the current card sizes — shrinking the cards without re-tuning those padding constants in lockstep risks visually breaking the camera framing the existing system carefully tuned. This needs iterative visual verification, which belongs in Phase 6, not a speculative edit here.

**Decision — camera:** heading-up follow (map rotates to travel direction), tilt ~50°, zoom ~17-18 scaled to speed, marker anchored ~25-30% from the viewport bottom for road-ahead look-ahead, animated (not teleported) camera transitions synced to the same tick driving marker interpolation from Phase 2. This is the standard Google Maps-nav-mode / Uber Driver pattern, and it only became implementable cleanly once Phase 2 gives a stable snapped position+bearing to follow — hence the dependency ordering.

**Decision — chrome:** full-bleed map during active nav; top instruction and bottom trip cards become floating overlays instead of boxed sheets eating ~60-70% of vertical space (measured directly from the screenshots in §1). Per `ui-ux-pro-max`'s z-index and touch-target guidance, floating controls (Re-center, speaker, shield) keep a defined z-index tier and ≥44×44px targets.

**Build:**
- Driver nav screens (`NavigateToPickup.tsx`, `TripInProgress.tsx`): heading-up camera; strip boxed-card chrome to floating overlays; full-bleed map.
- Shrink `SelfCarMarker.tsx` / `CarMarker.tsx` icon ~30% (screenshot-confirmed oversized relative to road scale).
- Fix the orphaned bottom-left arrow button from image 3: either remove it if it's dead/leftover from a prior screen's layout, or give it a distinct icon + label if it's intentionally "open in external nav" — audit its source before deciding (don't guess-delete; the karpathy guideline against unrequested removal applies, but an icon-duplicate of Re-center with no label is a real bug, so this gets a decision, not a silent drop).
- Fix the clipped Hindi instruction text (image 2-3, text bleeding past card edge): this is a plain CSS overflow bug (`text-overflow: ellipsis` + `max-width` missing on the instruction label), one-line fix, no design system change needed.
- User app: align `apps/user/components/map/RoutePolyline.tsx` colors/stroke to `apps/driver/src/components/map/RoutePolyline.tsx`'s styling (Customer#1 — "same map design as driver"); fix initial map bounds to fit source+destination+driver (`fitBounds`-style) instead of a fixed wide zoom (Customer#3); re-verify Customer#2's "polyline not rendering" against Phase 2's snap fix before treating it as a separate rendering bug — the screenshot evidence suggests it may be the same root cause (raw-GPS/polyline divergence at turns), not a distinct data issue.

**Files:** `apps/driver/src/pages/NavigateToPickup.tsx`, `TripInProgress.tsx`, `apps/driver/src/components/map/SelfCarMarker.tsx`, `apps/user/components/map/CarMarker.tsx`, `apps/user/components/map/RoutePolyline.tsx`, `apps/driver/src/components/map/RoutePolyline.tsx`, user ride-tracking map viewport init.

**Not doing (explicitly, matching this repo's existing "declined" pattern):** wrapping the driver app as a fullscreen PWA/native shell to reclaim the browser URL-bar's ~12% of screen (image 1-3 all show it eating the top of the viewport). Real fix, but it's an infra/manifest decision (`display: standalone` + install prompt), not a code-diff-sized item — flag it for a separate one-off ticket, don't fold it into this plan's scope.

**Review checklist:**
- [ ] Map is the dominant visible surface (>60% of viewport) on both nav screens
- [ ] Camera stays heading-up and close-follow through a multi-turn drive, transitions are eased not jumpy
- [ ] Car marker visibly smaller, doesn't dwarf the road
- [ ] No icon-ambiguous or unlabeled floating buttons remain
- [ ] No instruction text clips past its card at any locale (test with a long Odia/Hindi string)
- [ ] User and driver route polylines are visually the same design language
- [ ] User tracking screen's initial zoom fits pickup+destination+driver without manual re-centering

**Effort:** Medium-Large (3-4 days incl. the motion/animation work — camera easing should get a pass from `design-motion-principles`: use `prefers-reduced-motion`-aware easing, exponential ease-out for camera moves, no bounce/elastic on a nav camera).

---

## Phase 5 — P2: Driver homepage layout — ✅ done 2026-07-12

**Found this was already a fully-built draggable snap-sheet** (ResizeObserver-measured `collapsed`/`peek` snap points, RAF-throttled map-occlusion sync) — the "collapsed" snap point was simply anchored at the wrong spot in the JSX (right after the stats row, per its own code comment), not missing functionality.

- **Driver#3:** moved the `collapseRef` sentinel from after the stats grid to right after the greeting+toggle row. The collapsed height is computed purely from that ref's DOM position (`anchorTop - sheetTop`), so this one-line relocation is the entire fix — collapsed now shows exactly handle + name + toggle, stats/quick-actions/status banner all shrink away on drag-down, revealing more map underneath.
- **Driver#2:** `OnlineToggle.tsx` shrunk 104px → 72px (icon 22→16, label 10px→8px) — well clear of the 44px touch-target floor.
- **Driver#1:** the floating header used a hardcoded `pt-12` (48px) instead of the safe-area-aware pattern every other floating overlay on this same screen already uses (`env(safe-area-inset-top)`), so it could sit flush against a device notch/status bar. Now `paddingTop: max(calc(env(safe-area-inset-top) + 12px), 48px)` — identical on non-notch devices (48px floor preserved), correctly padded on notched ones.

**Files touched:** `apps/driver/src/pages/Home.tsx`, `apps/driver/src/components/ui/OnlineToggle.tsx`. `tsc --noEmit` clean.

**Review checklist:**
- [x] Header never overlaps the map or the sheet handle at any sheet position (code-verified: safe-area padding, unchanged z-index layering)
- [x] Toggle is visibly smaller (72px), still ≥44px touch target
- [x] Collapsed sheet shows exactly name + toggle; drag up reveals the rest — needs a real-drag confirmation in Phase 6, the math is right but a drag gesture is best confirmed by hand

---

## Phase 6 — Final touches & sign-off (blocking, matches this repo's own Phase-5-doc precedent)

This repo's own history is the reason this phase exists: two prior "done" rounds on this exact nav surface were never verified on a real device, and the client stayed dissatisfied both times, and this investigation independently found a claimed "shipped" fix (bearing-gated heading) that isn't actually in the code. Nothing in Phases 1-5 gets called done at a desk.

1. **Cross-app consistency pass** — user and driver map/marker/route styling reviewed side by side; run an `impeccable critique` pass on both nav surfaces for stray inconsistencies (icon sets, shadow depth, color accents — the screenshots already flagged the red-outline safety shield clashing with the app's indigo accent, and near-flat/absent sheet shadows).
2. **Motion/accessibility audit** — `design-motion-principles` audit pass specifically on the camera easing and marker interpolation added in Phase 2/4: confirm `prefers-reduced-motion` is respected (fall back to instant/near-instant camera snaps), confirm no animation runs on a "frequent/every-tick" trigger without a frequency-gate justification.
3. **Real-device drive verification** — reuse the debug-overlay + drive-matrix pattern already defined in `NAVIGATION_PHASE5_FINAL_HARDENING_PLAN.md` Phase 5 rather than inventing a new process: two phones (mid-range Android + iPhone), at least one drive with turns, confirm heading settles <1s after a turn, marker never leaves the road line, SOS opens correctly from a real device, camera doesn't jitter at speed.
4. **Regression checklist** — golden path click-through (request ride → accept → pickup nav → trip → complete) on both apps; `cd api && npx tsc --noEmit`.
5. **Update this doc's Status line** to `Shipped` only after all of the above pass, with the same discipline the Phase 5 doc uses: filed fixes for any failed row must themselves be re-verified before sign-off, not assumed fixed.

**Effort:** Medium (2-3 days, can overlap with Phase 5).

### Round 1 field-test findings — 2026-07-12

First real-device/staging pass, three screenshots (driver Home, driver TripInProgress, rider tracking) against `er.clienttesting.in`, analyzed image-by-image. Findings, sorted by what they actually are:

**Not bugs — same root cause, already-working mechanism:** the car marker sitting off the route line (TripInProgress) and the rider-side marker staying dimmed/translucent both trace to one shared cause, confirmed by the rider screen's own banner: *"We noticed this trip hasn't updated in a while. Our support team has been notified and is reviewing it."* GPS had gone stale for this test session (matches the cleanup worker's 10-min stuck-ride flag firing correctly). Off-route fallback to raw position, and a marker that never reaches full opacity because `headingKnown` never resolves without fresh fixes, are both the *intended* behavior when GPS genuinely stops — snapping the marker onto a route it isn't really near, or faking a resolved heading, would be the actual bug. **Re-test needs a session with real/simulated continuous movement, not a stationary desk session, to confirm the Phase 2 fixes properly** — this round didn't actually exercise them.

**Real, fixed:** SOS trigger button on both nav screens sat only 8px (`mt-2`) below the instruction card, reading as crowded against its corner in the screenshot. Widened to `mt-3` on `NavigateToPickup.tsx` and `TripInProgress.tsx`.

**Real, flagged, not code — needs an infra check, not a diff:** the rider tracking screen rendered as a fully default/unstyled Google Map (visible "Keyboard shortcuts · Map Data ©2026 · Terms · Report a map error" footer, stock Google colors and POI icons) instead of the app's desaturated custom style. Checked the source: `apps/user/components/ui/MapViewInner.tsx` uses the exact same `mapId` + CSS-filter pattern as the driver app's `DriverMapView.tsx` (which rendered correctly styled in the same test round — see the Home screenshot), and both `.env.local` files have the identical Cloud Map ID configured. Next.js bakes `NEXT_PUBLIC_*` vars into the build at build time — if `er.clienttesting.in` is a staging deployment that was built before this env var was set (or its hosting env doesn't have it configured at all, separately from this repo's `.env.local`), the deployed bundle simply never got the ID. **Action: confirm `NEXT_PUBLIC_GOOGLE_MAPS_ID` is set in the staging host's environment and trigger a rebuild** — no code change indicated unless a rebuild doesn't fix it, in which case re-open this with a fresh screenshot.

**Not yet re-verified:** a stray observation that a stat-pill row looked slightly clipped above the bottom nav on the driver Home screenshot, in the sheet's default (non-collapsed) resting state — separate from the Phase 5 collapse-anchor fix, which only changes the *collapsed* state's content, not the default one. Plausible cause is a `100dvh`-vs-actual-visible-viewport mismatch (a well-known mobile-browser quirk when the address bar is showing) rather than anything Phase 5 touched — not acted on without confirming on-device whether it reproduces with the browser chrome hidden/shown, since a blind `dvh`→`svh` swap would touch every screen in the app (`Home.tsx`, `NavigateToPickup.tsx`, `TripInProgress.tsx` all use `h-[100dvh]`) on a one-screenshot hunch.

---

## Phase 7 — P1: Second round-trip field test (2026-07-13) — done 2026-07-13

Two new real-device screenshots from `er.clienttesting.in` (user app), analyzed directly, on top of Phases 1-6 above:

1. **"Driver has arrived" screen zoomed in absurdly tight** — buildings filled the screen, the (already-shrunk, Phase 4) car icon looked comically tiny, pickup pin and blue user-location dot almost touching.
2. **En-route screen**: car marker sat slightly off the blue route line, and the already-driven portion of the route never disappeared — the full original polyline stayed drawn for the whole trip instead of trimming behind the car, unlike every major ride-hailing app.

### 7a. fitBounds zoom-too-tight — root cause and fix

`RideMapScene.tsx`'s overview beat calls `FitBounds([driverPos, legTarget])` whenever a driver first appears near a leg. `FitBounds.tsx` had **no max-zoom clamp** — a well-known `fitBounds` pitfall: when the two points are very close (exactly "driver has arrived," ~10-50m apart), computed zoom shoots to 19-20+. Worse, this **stuck forever** on the user app specifically: unlike the driver app's `RecenterMap.tsx` (which re-applies `zoomForDistance()` every render and self-heals in ~600ms), the user app's `RecenterMap.tsx` only ever pans/moves camera — it has no zoom logic at all, so an extreme arrival-zoom persisted for the rest of the trip.

**Fix shipped:** `FitBounds.tsx` (user) and `FitBoundsToPoints.tsx` (driver, belt-and-suspenders — its own overview beat already self-corrects) now pre-set `map.setOptions({ maxZoom: 17 })` before calling `fitBounds`, restoring `maxZoom: null` on the next one-shot `idle` event. `fitBounds` natively respects `maxZoom`, so this prevents the overshoot rather than correcting it after a visible flash. z17 ≈ 300m viewport width — close enough to read "driver is right there" without amplifying GPS jitter (5-15m urban) into a visibly wandering marker, which is what z19+ does.

### 7b. No traveled-polyline trimming — root cause and fix

Confirmed via full read: `RoutePolyline.tsx` in both apps always rendered the entire decoded polyline from the last-fetched route string. The only "progress" indicator was `BreadcrumbTrail.tsx` (user), which *adds* a grey trail on top — never erases the original line. Both apps already computed the snapped point + matched `segmentIndex` every GPS tick via `nearestPointOnPolyline()` — it just wasn't exposed past deriving heading.

**Fix shipped**, following Mapbox's own "vanishing route line" pattern rather than inventing one: a static, never-trimmed full-route line renders underneath (`RoutePolyline`'s new `'traveled-backdrop'` variant, muted gray `#CBD5E1`), and the existing default-styled line on top now renders only the **trimmed remaining path** — so the traveled portion reads as the dim backdrop showing through, with no trim-seam flicker.
- `useInterpolatedPosition.ts` (user) and `useTurnByTurn.ts` (driver) now also return `matchedSegmentIndex`/`snappedSegmentIndex`, each **monotonically non-decreasing** (clamped forward via a ref, reset only when the route itself is refetched) — without this, GPS jitter or a round-trip route whose legs run near each other could walk the index backward and make the vanished line visibly "grow back" (a bug Mapbox's own navigation SDK hit and documented).
- `RideMapScene.tsx` (user), `NavigateToPickup.tsx`/`TripInProgress.tsx` (driver) derive `remainingPath = [snappedPoint, ...routePoints.slice(segmentIndex + 1)]` and feed it to the top `RoutePolyline` as `positions`, falling back to the full `encoded` route whenever there's no snap yet (off-route, or before the first snap) — mirrors this codebase's existing raw-GPS-fallback convention.
- Fixed a pre-existing off-by-one in `RoutePolyline.tsx` (both apps): the `positions` branch required `length >= 3`, silently refusing to render a valid 2-point remaining path near the end of a route (the `encoded` branch two lines below only required `>= 2`).
- Left `TrafficColoredRoute`'s separate traffic-interval overlay untouched — different data source, out of scope for this trim.

### 7c. "Car looks off-lane" — a real bug found, not just GPS noise

`CarMarker.tsx` (user) and `SelfCarMarker.tsx` (driver) both render an `AdvancedMarker` with no `anchorPoint` set, which defaults to `BOTTOM` (confirmed by reading `@vis.gl/react-google-maps`'s source) — i.e. the true GPS coordinate maps to the bottom-center of the marker's content box. The inner car div is then rotated via `transform: rotate(heading)`, which rotates around its own center (default `transform-origin`), not the bottom anchor. Whenever heading isn't ~0°/180° (the car isn't pointed due north/south), the visually-rotated car drifts sideways from the true coordinate by roughly `halfHeight × sin(heading)` — reading exactly as "car sitting one lane off," worse the more the road bearing diverges from north. This is a more precise explanation than "GPS is just noisy": the corridor-snapping from Phase 2 was already correct, the *rendering* of the snapped point was the bug.

**Fix shipped:** both markers now pass `anchorPoint={AdvancedMarkerAnchorPoint.CENTER}`, aligning the anchor with the rotation origin so the marker's anchor point stays visually pinned to the road through a turn, at any heading.

**GPS accuracy filtering — checked, already covered:** the plan considered adding a `coords.accuracy` filter on both apps. Found the driver app already gates every fix on `accuracy <= 80m` before accepting or syncing it (`useDriverLocation.ts`); the user app's `driverPos` only ever arrives pre-filtered through that same sync pipeline (no raw accuracy value is forwarded to filter again). Adding a second filter would need new plumbing through the whole location-sync payload for marginal benefit over the existing gate — not done.

**Explicitly not done:** full road-graph map-matching (declined already, per this doc's own "ops burden not worth it for 3 corridors" call), Kalman filtering on raw coordinates, tilt/3D camera for the rider view (flat is already correct, shipped Phase 4).

### 7d. Bottom-sheet whitespace — flagged, not fixed blind

The user also asked about "arrived at pickup" bottom-sheet whitespace, on a screenshot that (per its OTP/driver-row layout) is actually the **user app's** ride-tracking sheet (`ride/[id]/page.tsx`), not the driver app's own active-ride sheet. Read the file in full: it's `flexShrink: 0` intrinsic-height content, no fixed min-height, no explicit bottom padding after the "Trip details" toggle — nothing in the layout should produce a large dead-space gap. Round-1's own findings (§ above) already flagged the likely cause of gaps like this: a `100dvh`-vs-visible-viewport mismatch on mobile browsers, which this doc has already declined to blind-fix once "on a one-screenshot hunch." Not touched again here for the same reason — flagged as a named on-device check (compare with the browser address bar shown vs. hidden) rather than dropped; if confirmed, the fix is a coordinated `h-[100dvh]` → `h-[100svh]` swap across every screen that uses it, not a one-screen patch.

**Files touched:** `apps/user/components/map/FitBounds.tsx`, `apps/driver/src/components/map/FitBoundsToPoints.tsx`, `apps/user/components/map/CarMarker.tsx`, `apps/driver/src/components/map/SelfCarMarker.tsx`, `apps/user/lib/useInterpolatedPosition.ts`, `apps/driver/src/lib/useTurnByTurn.ts`, `apps/user/components/map/RoutePolyline.tsx`, `apps/driver/src/components/map/RoutePolyline.tsx`, `apps/user/components/map/RideMapScene.tsx`, `apps/user/app/(main)/ride/[id]/page.tsx`, `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx`, `apps/driver/src/pages/ActiveRide/TripInProgress.tsx`.

`tsc --noEmit` clean on both `apps/user` and `apps/driver`.

**Review checklist:**
- [ ] "Driver has arrived" map settles at a readable zoom (≈17), not 19-20+, no visible zoom-in-then-snap-back flash
- [ ] Blue polyline visibly shortens from the tail as the car advances on a multi-turn drive, gray backdrop showing through behind it, no flicker
- [ ] Route never "grows back" on a round-trip route where outbound/return legs run near each other
- [ ] Car marker's anchor point stays visually pinned to the road centerline through a turn where heading swings well off 0°/180°, not just facing north/south
- [ ] Existing Phase 2 checklist items still hold (marker stays on route through turns, heading never flips)
- [ ] 7d real-device check (dvh vs address-bar state) run before any follow-up diff

**Effort:** Medium (2-3 days incl. real-device verification for the checklist above).

---

## Phase 8 — P2: Collapsible driver active-ride sheet (2026-07-13) — done 2026-07-13

Follow-up to the user's whitespace comment on Phase 7's round: not a layout bug, but a request — while navigating, the map should be the priority, and the driver should be able to shrink the trip card out of the way and still reach "Arrived"/"Complete Trip" without hunting for it.

**Reused rather than built:** `Home.tsx` already has a fully-built draggable snap-sheet (Framer Motion `motionValue`-driven height, `ResizeObserver`-measured collapse point, spring-physics snap with velocity-based direction, RAF-throttled occlusion sync to the map camera). `NavigateToPickup.tsx` and `TripInProgress.tsx` now use the same mechanics, with one deliberate difference from Home's version: **the primary CTA is never the thing that collapses away.** Home's collapsed state hides everything except greeting+toggle; here, the collapse anchor sits *below* the CTA instead of above it, so "Arrived at Pickup" / "Complete Trip" stays reachable at every sheet height — only the rider-info card, context banners, stop itinerary, and (pickup screen) the cancel-ride link fade out as the sheet collapses.

**Also added, from a driver-app UX research pass (Uber/Ola/Lyft-style driver apps):**
- A mini always-visible status line above the CTA (rider name + rating on the pickup screen; current-stop/destination + fare on the trip-in-progress screen) — a collapsed sheet showing only a bare button was flagged as wrong per how these apps actually behave: a driver glancing mid-drive needs "who/what's next" more than the action button alone.
- Tap-to-toggle on the handle, not just drag-to-resize — a driver holding the phone one-handed needs a big, forgiving tap target as much as a precise swipe gesture. Implemented via a movement-distance threshold (<6px total = tap) on the same pointer handlers driving the drag, rather than a separate `onClick` (avoids the double-fire/threshold gotchas of layering a tap handler on manual pointer-driven dragging).
- `RecenterMap`'s `bottomPadding` and the floating Voice-mute/Re-center/"open in external maps" buttons now track the sheet's actual live height (`occlusion` state, RAF-throttled off the same motion value) instead of a hardcoded constant — previously these assumed a fixed ~220-344px sheet height, which would have been wrong the instant the sheet became collapsible.

**Deliberately not done, flagged for a separate decision:** the research also surfaced that production driver apps often use a swipe-to-confirm slider (not a plain tap button) for trip-state-changing actions like "Complete Trip," specifically to prevent accidental taps on a phone bouncing in a mount — and that some apps auto-collapse the sheet the moment navigation starts rather than defaulting to expanded. Both are real patterns but are behavior changes beyond what was asked here (map-visibility control, not confirmation-safety or a new default state) — not implemented in this pass.

**Files touched:** `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx`, `apps/driver/src/pages/ActiveRide/TripInProgress.tsx`.

`tsc --noEmit` clean.

**Review checklist:**
- [ ] Drag the handle on both screens: sheet resizes smoothly between collapsed and peek, springs to the nearer snap point on release, faster flick snaps in the flick direction
- [ ] Tap the handle (no drag): sheet toggles between collapsed and peek
- [ ] At the most collapsed height, the CTA button and mini status line are still fully visible and tappable; rider details/banners/stop list/cancel link are the only things that faded away
- [ ] Map visibly reclaims the space the sheet gave up as it collapses (camera re-centers, doesn't leave a dead gap or clip under the shrunk sheet)
- [ ] Voice-mute button, re-center chip, and (trip-in-progress) the external-maps button never overlap the sheet nor float oddly far above it at any sheet height
- [ ] `prefers-reduced-motion`: snap transitions become instant, no spring bounce

**Effort:** Small-Medium (1-2 days incl. real-device drag-feel verification).

---

## Phase 9 — P0: Off-route/snap gate is distance-only — route chord + frozen banner (2026-07-13)

Seven new real-device screenshots (driver app, Bhubaneswar/Puri corridor, `er.clienttesting.in`), analyzed directly. Two visible symptoms:
1. The bright nav route line periodically draws a straight diagonal chord across buildings/blocks instead of following the road.
2. The turn banner ("460m, RI Office Rd तीव्र राइट...") stays frozen with the identical instruction across multiple screenshots while the car is visibly on different streets (Kunjapatna Rd → Daka Bangala Chowk → Darji Sahi Rd).

**Root cause (one shared flaw, both symptoms):** `useTurnByTurn.ts`'s snap effect (lines 148-190) gates a GPS fix as "on route" using **distance only** (`OFF_ROUTE_THRESHOLD_METRES = 40`, no bearing check). On dense parallel streets, a fix on a genuinely different real road can still land within 40m of the *old* polyline, so `nearestPointOnPolyline()` force-snaps it there anyway. `TripInProgress.tsx`/`NavigateToPickup.tsx` then draw `remainingPath = [snappedPosition, ...routePoints.slice(segmentIndex+1)]` — a straight line from that wrong-road snap point to the next real route point, i.e. the chord through buildings. The same wrong snap also means `offRouteStreak` never increments (the fix reads as "on route"), so no reroute fires — and separately, step-advance (line 182-188) only fires within `STEP_ADVANCE_THRESHOLD_METRES` (25m) of the *current* step's geometric endpoint, which the vehicle may never reach if it's actually on a different street — hence the frozen banner.

**Decision:** add the two guardrails production map-matching already relies on (bearing agreement, bounded forward jump) directly to the existing snap effect — no new algorithm, no HMM/Viterbi map-matcher (that's a real upgrade path, tracked below as explicitly deferred, matching this doc's recurring "no speculative infra" principle). `useDriverLocation.ts` already computes a movement-derived heading (gated, non-jittery) that both nav screens already read as `selfHeading` for the camera — reused as-is, no new plumbing.

**Fix shipped:**
- `useTurnByTurn()` gains an optional `heading` parameter (4th arg); both call sites pass their existing `selfHeading` through.
- The snap effect now rejects a fix as unsnapped (same code path as the existing distance gate) when the device heading disagrees with the matched segment's bearing by more than `OFF_ROUTE_BEARING_THRESHOLD_DEG = 55°` — this is what stops the force-snap onto a parallel wrong road, and correctly feeds `offRouteStreak` so a genuine road change now triggers a reroute instead of silently reading as "on route."
- The forward-segment clamp (previously `Math.max(snapped.segmentIndex, lastSegmentIndex.current)` with no bound) now rejects a snap whose segment index jumps more than `MAX_FORWARD_SEGMENT_JUMP = 80` points ahead of the last confirmed one — marked `ponytail:` as an index-count proxy for "implausibly far, too fast" rather than a real elapsed-time/speed computation; tighten if field data shows it's too loose.
- Step-advance now self-heals: alongside the existing 25m-to-step-end trigger, a new `stepStartIndex` array (built once per route fetch, the running start-segment-index of each step) lets the updater jump `currentStepIndex` forward to match wherever `snappedSegmentIndex` already is, so a missed maneuver-endpoint radius no longer freezes the banner indefinitely.

**Implementation note:** `isTrustworthySnap`/`angularDiffDeg` ended up in `apps/driver/src/lib/geo.ts` (not `useTurnByTurn.ts`) — pure geo math with no dependency on the API client, matching where `nearestPointOnPolyline`/`bearingDeg` already live, and it's what let the regression check below run standalone via `tsx` without pulling in `ride-api.ts`'s `import.meta.env` (which only resolves inside Vite).

**Explicitly not done (deferred, needs field data from this fix first):** a real local map-matching window (top-k candidate segments scored over a short sliding history, à la a lightweight Viterbi) — the fable-drafted plan flagged this as the next tier if the bearing+jump gate above still mis-snaps in the field; not building it speculatively. Also not done: unifying `TrafficColoredRoute`'s independently-fetched geometry with the main route (separate, lower-severity cosmetic divergence, not the chord bug), and moving off the public OSRM demo fallback tier onto self-hosted infra (business/ops decision, not a code fix).

**Files:** `apps/driver/src/lib/geo.ts`, `apps/driver/src/lib/useTurnByTurn.ts`, `apps/driver/src/lib/__checks__/snap-gate.check.ts` (new), `apps/driver/src/pages/ActiveRide/TripInProgress.tsx`, `apps/driver/src/pages/ActiveRide/NavigateToPickup.tsx`.

**Review checklist:**
- [x] `tsc --noEmit` clean on `apps/driver` — confirmed 2026-07-13
- [x] Synthetic check: GPS fix 25m off the route polyline with a heading ~90° off the segment bearing (parallel wrong street) is rejected as unsnapped; a fix 5m off with heading matching the segment is accepted — `snap-gate.check.ts` passes (`npx tsx apps/driver/src/lib/__checks__/snap-gate.check.ts`)
- [ ] Drive/replay a route past a parallel side-street within 40m of the main road; marker does not snap onto the wrong street, no diagonal chord rendered — **needs a real device/drive, not verifiable from this environment**
- [ ] Force an off-route excursion (bearing mismatch case, not just distance); reroute fires after 3 consecutive fixes + cooldown, same as the existing distance-triggered path — **needs a real device/drive**
- [ ] Banner advances correctly even when a maneuver's 25m endpoint radius is missed on a wide/fast turn — **needs a real device/drive**
- [ ] Existing Phase 2 checklist items still hold (marker stays on route through turns, heading never flips) — this phase only tightens the gate, doesn't change the rendering path — **needs a real device/drive**

**Effort:** Small (same-day patch — shipped as one file split across `geo.ts`/`useTurnByTurn.ts` + two one-line call-site changes + one regression check). **Status: code complete + typecheck + synthetic check passing, 2026-07-13. Real-device drive verification still outstanding — do not mark this phase fully done until that's run, per this doc's own Phase 6 precedent (two prior "done" rounds on this exact surface were claimed complete without device verification and stayed broken).**

---

## Sequencing summary

```
Phase 1 (SOS)         ─┐
Phase 2 (snap+heading) ─┼─ parallel, independent ──→ Phase 4 (camera/chrome, depends on Phase 2)
Phase 3 (ETA+presence) ─┘                                        │
Phase 5 (homepage)     ─────────── independent, any time ────────┤
Phase 9 (snap gate)    ─────────── depends on Phase 2's snap/heading plumbing ─┤
                                                                    ▼
                                                            Phase 6 (verification + sign-off, blocking)
```
