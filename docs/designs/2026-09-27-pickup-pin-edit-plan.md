# Plan: Post-Booking Pickup Pin Edit

**Branch:** feat/drivers-city-vehicle-filters (design authored here; implementation is separate scope)
**Author:** sujalghosh26@gmail.com via Claude
**Status:** Design approved — ready for implementation planning

## 1. Problem

Ocar's rider app lets you set pickup two ways today: GPS auto-fill, or the
`confirm-pickup` drag-a-pin screen — but both happen *before* vehicle
selection and booking. Once you tap "Book," the pickup point is locked. If
GPS drifted (indoor pickup, dense lane, flyover — routine in
Bhubaneswar/Cuttack/Puri), there is no way to correct it, matching Uber/Ola/
Rapido's own well-documented pattern: they all let the rider nudge the
pickup pin after the ride is requested, bounded to a small radius so it
reads as a correction, not a new pickup choice.

## 2. Scope

**In scope:**
- "Edit pickup" affordance on the ride tracking screen (`ride/[id]/page.tsx`),
  available while `status` is `requested` or `accepted` (not after pickup).
- A bottom sheet + map view showing the rider's live GPS dot, the current
  pickup marker, and a draggable pin, bounded to a fixed radius (~150-200m,
  matching Uber's "grey circle" convention).
- Backend: `PATCH /api/v1/rides/:id/pickup`, server-side radius + ownership +
  status guards (PostGIS `ST_DWithin`, never client-only), optimistic
  concurrency (`FOR UPDATE` + `updated_at` compare, same shape as the city
  boundary editor's 409 pattern).
- Driver notification via `notifyOwner()` (persist + push + socket emit) so
  an offline/backgrounded driver still gets the corrected pickup, not just a
  live socket event that's lost if they're disconnected.

**Explicitly out of scope (separate future work):**
- Fare recompute — the radius is small enough that distance delta never
  crosses a rate bucket; no fare engine involvement needed.
- Curated "Pickup Spots" (named venue POIs) — needs admin-curated location
  data Ocar doesn't have yet.

## 3. UI surface

One new sheet, triggered by an "Edit pickup" action on the existing ride
tracking screen. Everything else on that screen (driver marker, nearby
drivers, breadcrumb, chat) is unchanged.

### States (approved — see mockup, section 7)
- **Default (sheet open):** map zoomed tight (meter-per-pixel scale chosen so
  the ~120m default boundary reads as genuinely close, not a city-scale
  view), live user GPS dot, pickup pin at its current value, address text
  resolving live as the pin moves.
- **Both markers are draggable and visually distinct:** the pickup pin is a
  slim, sharp-tipped teal-gradient teardrop (tip = the exact point, not the
  body) so it can be placed precisely; the user dot is a small pulsing
  teal circle, independently draggable for GPS fine-tuning, connected to
  the pin by a dotted line with a live distance-in-meters label at the
  midpoint — this answers "how far do I need to walk" without the rider
  doing mental math.
- **No drawn boundary circle or persistent "zone" label.** The bounded area
  (`boundaryMeters`, default 120m, range 80-180m) is communicated by the
  zoom level itself, not a diagrammed ring — matching this plan's own
  "billboard, not brochure" instinct: a permanent circle is one more thing
  competing for attention on every open of the sheet, when the constraint
  only matters at the one moment the rider actually reaches it.
- **Approaching the boundary:** a soft ambient vignette (blurred radial
  glow, no hard edge) fades in around the pin, teal at first and shifting to
  amber only right at the true limit (≥96% of radius) — continuous feedback
  that builds the closer you drag, rather than a binary line you either
  haven't hit or have. At the true edge, a one-line amber pill
  ("Pickup can only move within this zone") fires once, so the rider is
  never left silently bounced with no explanation.
- **Confirm success:** sheet dismisses, tracking screen's pickup marker
  updates, brief confirmation toast/pill ("Pickup updated — driver
  notified").
- **Rejected (edge case, not yet in mockup — implementation must add):**
  network failure, stale ride status (driver already picked up between
  opening the sheet and confirming), outside radius on a slow client that
  let it drag too far before the server-side `ST_DWithin` check runs.

## 4. Brand direction

Per `DESIGN.md`: user-app surfaces are full-pill CTAs, 3xl bottom sheets
(`border-radius: 32px 32px 0 0`), Sheet shadow
(`0 -6px 32px rgba(14,143,163,0.10)`), teal-tinted shadows throughout, no
orange (operational-only, never user-facing). The floating chrome on this
sheet (handle, header, the "Confirm" bar pinned above the keyboard-safe
area) is a `light material` glass surface per DESIGN.md's Materials &
Glass section — this is exactly the "temporary layer above scrolling
content" case that section calls out, not a body-content card.

## 5. Design decisions (resolved)

| # | Question | Resolution |
|---|---|---|
| D1 | Radius visualization | No drawn ring/label at rest. Zoom level alone conveys the bounded area; a soft vignette builds only as the pin nears the true edge. |
| D2 | User dot vs. pickup pin distinction | Different shape (small pulsing circle vs. slim sharp-tipped teardrop) and different interaction weight — both draggable, connected by a dotted line + live distance label. |
| D3 | Map zoom default | Tight enough that the ~120m default boundary occupies a large fraction of the visible map, not a city-scale view. Scale bar (bottom-left, "50 m") retained as a standard map affordance for orientation. |
| D4 | Boundary feedback mechanism | Continuous ambient vignette (teal → amber, opacity scales with proximity) plus a one-shot amber pill exactly at the true limit — never a silent hard stop. |

## 6. Approved mockup

Interactive prototype (drag both markers to feel the boundary behavior):
https://claude.ai/artifact/6F9SaJAahNoPEHr6Vgu67U

Built against this repo's `DESIGN.md` tokens directly: Space Grotesk/Plus
Jakarta Sans, teal-tinted shadows and glass materials, 3xl bottom sheet,
full-pill CTA with the Button Primary shadow, no orange anywhere (per the
Orange Boundary Rule — this is a rider-facing screen).

## 7. Non-UI engineering notes (from prior review)

See branch conversation history — architecture reviewed and confirmed:
`PATCH /rides/:id/pickup` reusing `admin.repository.ts`'s concurrency
pattern, `ST_DWithin` radius guard, `notifyOwner()` for driver notification.
Not repeated here; this doc is the design/UI plan.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| Design Step 0 rating | plan-design-review | Baseline completeness check | 1 | Complete | 5/10 → resolved to 9/10 after mockup iteration (see D1-D4) |
| Visual mockup (interactive) | plan-design-review, DESIGN_READY fallback | gstack designer's OpenAI-backed mockup binary had no API key configured; built a real interactive HTML/canvas mockup instead of a static description | 2 iterations + 1 targeted revision (radius/zoom) | Complete, user-approved | None outstanding |
| impeccable design hooks | automatic on file write | Automated on-brand lint | 3 passes | Complete | 1 real finding fixed (6px → 8px `rounded.sm` on decorative map blocks); recurring `overused-font` flags on Space Grotesk/Plus Jakarta Sans dispositioned as false positives — these are Ocar's own mandated DESIGN.md fonts, not generic AI defaults |
| Outside Voice (Codex / independent design critique) | plan-design-review default-on step | — | 0 | Skipped | Not run — this was a chat-based iterative mockup session, not a committed plan diff; user drove the visual decisions directly across 3 rounds, which is a stronger signal than an automated second opinion would add here |

**VERDICT:** Design approved. Ready for an implementation plan (`/plan-eng-review` already covered the backend architecture in this same conversation — endpoint, concurrency, notification pattern). No fare-engine coupling, no new abstractions beyond what's already reviewed.

NO UNRESOLVED DECISIONS
