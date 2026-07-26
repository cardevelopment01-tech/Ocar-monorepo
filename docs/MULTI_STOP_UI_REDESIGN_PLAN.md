# Multi-Stop UI/UX Redesign Plan — Rider & Driver

**Ocar · design deliverable · planning only, no code changed**

Turns the *functional-but-utilitarian* multi-stop UI into an industry-grade, premium, at-a-glance
experience. Grounded in: research of Uber/Lyft/Bolt/Grab/Citymapper multi-stop UI, the current
Ocar implementation (audited below), and Ocar's `DESIGN.md` (indigo `#4F46E5`, violet `#7C3AED`
waypoints, Inter, mobile-first, "clarity is the feature", WCAG AA, 44px targets, reduced-motion).

---

## 0. The one-line diagnosis

The plumbing and the states are all correct; what's missing is that **stops are rendered four
different ways across four surfaces, none of them a connected timeline, and the map never shows
them at all.** The fix is one shared timeline component + putting stops on the map — not new
features.

### Current state (audited)

| Surface | Today | Gap |
|---|---|---|
| Booking (`/round-trip`, `/rental`) | Route-card rows, violet-square nodes, dashed "+ Add" ghost | **No connecting line**; add-stop is a full-screen `/search` bounce |
| `/select-ride` | Separate compact stops card + wait disclosure | **Map shows no stop pins / no detour polyline** |
| Live tracking (`/ride/[id]`) | Flat gray list; icon swap only (check / strike) | **No "Stop N of M", no current-leg emphasis, no map pins, no progress** |
| Driver active ride | Checklist (`border-left` accent) + wait banner | **No "current leg" hero; left-stripe accent violates design bans; tap not swipe** |

---

## 1. Design principles for this feature

1. **One journey, one spine.** Every surface renders the itinerary as a single vertical
   connected-node timeline — the connecting line is the hero, not decoration.
2. **Shape + number, never color alone.** Order and role are legible without color (a11y: indigo
   and violet are close in hue; color-blind safe). The number carries order; color reinforces.
3. **The map is part of the itinerary.** Stops are numbered pins that match the timeline chips;
   editing the plan makes the map breathe (`fitBounds`).
4. **Restrained motion.** Controlled ease-out (`cubic-bezier(0.22,1,0.36,1)`), no bounce/elastic —
   "speed is felt, not theatrical." Motion only on state *change*, never ambient.
5. **Driver = 3-foot glance.** One dominant next-stop target, swipe (not tap) to advance, ≥`text-2xl`
   primary, one primary action visible.

---

## 2. The core component — `<RouteTimeline>` (rider) / `<RouteLeleg>` (driver)

A single component powers booking, select-ride, and tracking in the **user app** (real reuse across
3 surfaces). The **driver app** gets a sibling with the same visual grammar (no shared runtime
package exists — `packages/` is config-only — so it's a deliberate one-file duplication, matching
how types are already duplicated per app).

### Node grammar (shape encodes role)

| Role | Glyph | Token |
|---|---|---|
| Origin | filled ring, 12px | indigo `#4F46E5` |
| Stop (pending) | **round numbered chip** `1 2 3`, 20px | violet `#7C3AED` on `#EDE9FE` |
| Stop (reached) | check glyph, morphed from the number | success `#10B981` |
| Stop (skipped) | hollow ring + strikethrough row | ink-400 `#94A3B8` |
| Destination | filled rounded-square pin, 12px | indigo `#4F46E5` |

> Changed from today's identical violet squares → **numbered violet chips**, so "which stop is #2"
> is answerable at a glance and matches the map pins (§4). Origin/destination stay circles/squares
> for instant start-vs-end parsing.

### The connecting line (the hero)

- 2px vertical spine through every node center.
- **Upcoming** segment: `#C7D2FE` (primary-light), solid.
- **Active** segment (live trip, the leg the car is on): `#4F46E5`, with a slow shimmer (a 1.6s
  translated gradient, `prefers-reduced-motion` → static).
- **Completed** segment: solid `#10B981` — progress "pours" down the spine as stops are reached.

### Row anatomy (60px, Inter)

```
[node] ── FROM / STOP 1 / TO (10px, 600, uppercase, ink-400)
          Place name        (14px, 500, ink-900, truncate)
          Full address      (12px, 400, ink-600, truncate)     [⇅ swap] [× remove]
```

Trailing controls appear only on **stop** rows; origin/destination have none. `⇅`/`×` are 44px
touch targets (visually 28px). **No `border-left` accent anywhere** (design ban) — current-leg
emphasis is `background: #EEF2FF` tint + node scale 1.0→1.08 + label weight 600.

---

## 3. Interactions

### 3.1 Add a stop — bottom sheet over the map (kills the full-screen bounce)

- Trigger: violet **`+ Add stop`** ghost row, directly beneath the last stop / above destination.
- Opens an **85vh bottom sheet** over the map (built with the app's existing Framer Motion +
  `createPortal` pattern — **no `vaul`/new dep**), search input auto-focused, **recents/saved
  places first** so most adds are one tap. Reuses `geoApi.autocomplete`/`placeDetails`.
- On select: sheet drops (240ms ease-out), node **enters** at its slot (§5), map `fitBounds`.
- Replaces the current `/search?stopIndex=` route push on `/round-trip`, `/rental`, `/select-ride`.

### 3.2 Reorder — swap, not drag (right complexity for ≤3 stops)

- A violet **`⇅` swap** control on each adjacent stop pair reorders in place (research: swap beats
  drag below 4 waypoints; we cap at 3). **No `dnd-kit`/new dep.**
- Params re-sequence via the existing `router.replace`; rows animate to new positions with Framer
  `layout` (position *is* the meaning — never cross-fade).
- Optional later: an indigo "Reorder to save ~X min?" snackbar when order is inefficient — never
  auto-reorder silently.

### 3.3 Live-trip progress (tracking screen)

- Compact live card: **"Stop 2 of 3 · Cuttack · 8 min"** (stepped mini-bar at top), expandable to
  the full spine.
- On `stop:updated` (socket, already wired): number→check **morph** (240ms), row strikes to
  ink-400, the segment behind it **fills** `#10B981`. Current node pulses; upcoming muted.

---

## 4. Map visualization (the biggest new surface)

Applies to `SelectRideMapScene` (select-ride) and the tracking map.

- **Numbered violet pins** for stops (number matches the timeline chip), indigo puck for origin,
  indigo pin for destination.
- **Multi-leg polyline:** active leg `#4F46E5`→`#7C3AED` solid; upcoming legs `slate-300` dashed;
  completed legs solid `#10B981`. **Requires the routed leg polylines** — today `/select-ride`
  only has the origin→dest polyline and sums leg *distances*; this needs the per-leg `getRoute`
  polylines concatenated (small addition to the existing routing effect).
- **Animated `fitBounds`** (with sheet-height padding) on every stop add/remove/reorder — "the map
  breathes."
- **Bidirectional focus:** tap a timeline row → map `flyTo` its pin; tap a pin → scroll+highlight
  the row.

---

## 5. Motion spec (design-motion-principles)

All ease-out `cubic-bezier(0.22,1,0.36,1)` unless noted; every effect has a reduced-motion fallback.

| Moment | Motion | Duration |
|---|---|---|
| Node enter (add) | scale 0.9→1 + fade; connecting line **draws** into it (`pathLength 0→1`) | 260ms / line 300ms |
| Node exit (remove) | height collapse + fade; siblings close gap (`layout`) | 200ms |
| Itinerary first paint | staggered top→bottom reveal | `stagger 40ms` |
| Swap reorder | rows `layout`-animate to new slots | 220ms |
| Stop reached (live) | number→check morph + segment fill "pour" | 240ms |
| Active-leg segment | slow gradient shimmer | 1.6s loop |
| Map edit | `fitBounds` camera ease | native ease |
| Haptic (mobile) | light `navigator.vibrate(15)` on add / swap / stop-complete | — |
| Reduced motion | all of the above → 120ms opacity fade, no transforms | 120ms |

No bounce, no elastic, no ambient looping except the single active-leg shimmer (which conveys
"this leg is live").

---

## 6. Driver side

### 6.1 Current-leg hero card

`[violet "Stop 2 of 3" pill] → [BIG next-stop name, text-2xl/600] → [addr · ETA · distance] →
[indigo swipe-to-confirm] → [collapsed "2 more stops ⌄"]`. One dominant target, one action.

### 6.2 Swipe-to-confirm (replaces tap Reached/Continue)

- Indigo **slide-to-confirm** ("Slide to confirm arrival →", then "→ Start next leg"). Accident-proof
  on a mounted phone; matches the app's existing swipe controls (OTP/complete) — reuse them.
- On confirm: card **swaps** (200ms slide), map re-frames to next leg (existing per-leg beat),
  counter ticks, checklist row checks + haptic. For **one-way**, the wait meter banner (already
  built) sits between "arrived" and "start next leg."

### 6.3 Checklist — three visual tiers

Done (check + strikethrough, ink-400) · Current (tint + bold + node scale, **no left stripe**) ·
Upcoming (violet number chip, muted). Collapsed strip → expands to full checklist.

---

## 7. Accessibility (non-negotiable, per DESIGN.md)

- Order encoded by **number**, not color alone. `aria-label` per node ("Stop 2, Cuttack, current").
- Swap has explicit buttons (no drag = no keyboard trap); all targets ≥44px.
- Live progress uses `aria-live="polite"` ("Arrived at Stop 2").
- Body/label contrast ≥4.5:1 (ink-600 on light surfaces passes; ink-400 only for muted/skipped).

---

## 8. Phased rollout (value ÷ effort)

**Phase 1 — the timeline component (highest value, pure component, no deps).**
Build `<RouteTimeline>` (numbered chips + threaded line + shape-coded endpoints + states + motion),
swap it into `/round-trip`, `/rental`, `/select-ride`, and tracking. Fixes "4 different renderings"
and "no connecting line" instantly. Driver checklist restyled to the same grammar (drop the
left-stripe). *Verify: all 4 surfaces render identically; reduced-motion fallback works.*

**Phase 2 — add-stop bottom sheet (kills the jarring bounce).**
Replace the `/search?stopIndex=` route push with the 85vh sheet-over-map. Swap-reorder control.
*Verify: adding a stop never leaves the booking screen; state survives.*

**Phase 3 — map visualization (biggest effort, biggest "understandable" win).**
Numbered pins + multi-leg polyline (concatenate per-leg `getRoute` polylines) + animated
`fitBounds` + tap-row↔tap-pin coupling, on select-ride and tracking maps.
*Verify: pins match chips; map re-frames on edit; detour is visible.*

**Phase 4 — live-trip progress + driver swipe-to-confirm hero.**
"Stop N of M" card, pouring-line progress, check-morph; driver current-leg hero + slide-to-confirm.
*Verify: socket stop-update animates progress; driver advance is one swipe.*

**Explicitly not doing:** drag-to-reorder (`dnd-kit`), `vaul` sheets, lettered pins, mid-trip
add-stop (separate feature), route-optimization suggestions (Phase 5+ if asked).

---

## 9. Decisions to confirm

1. **No new dependencies** (swap not drag, Framer sheet not vaul) — agreed default; say if you want
   true drag.
2. **Numbered violet chips** replacing plain violet squares — the one visual identity change.
3. **Phase order** above (component → sheet → map → live/driver), or map-first if the demo needs the
   "wow" sooner.
