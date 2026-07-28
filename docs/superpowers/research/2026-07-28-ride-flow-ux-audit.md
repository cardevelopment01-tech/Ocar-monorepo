# Ride Flow UX Audit — User + Driver

Date: 2026-07-28
Scope: full passenger booking→tracking→rating flow, full driver online→pickup→trip→cash flow.
Method: two independent research passes (user-side, driver-side) over every screen in the flow, benchmarked against Uber/Ola/Lyft/Rapido/Grab/inDrive equivalents. Findings are about flow/IA/options, not visual polish.

Status legend: ⬜ not started · 🟨 in progress · ✅ done

---

## P0 — fix first (trust/safety-breaking)

- ✅ **[Driver] `TripEnd.tsx:24-25`** — Commission (15%) is hardcoded client-side (`fare * 0.15`) instead of reading what the backend actually applied. Driver's "you keep ₹X" can mismatch the real wallet ledger entry.
  Fix: return the actual applied commission from the backend response; stop recomputing on the client.

- ✅ **[Driver] `TripInProgress.tsx`** — No way to end/abort a trip once `in_progress` (only SOS exists). A real mid-trip issue (breakdown, dispute) has no graceful exit.
  Fix: add "End trip early" with a reason sheet + partial-fare settlement, mirroring the pre-pickup cancel flow in `NavigateToPickup.tsx`.

- ✅ **[Driver] `NavigateToPickup.tsx` / `TripInProgress.tsx`** — No GPS-loss warning during active navigation (Home has one; the actually safety-critical screens don't). Map silently goes stale mid-drive with no driver-facing warning.
  Fix: reuse Home's GPS-error banner pattern in both active-ride screens.

---

## P1 — next

### User side
- ⬜ **`ride/[id]/page.tsx:751`** — Cancel is buried behind an expand step once a driver is assigned; no persistent cancel affordance in the collapsed peek row.
  Fix: move a compact cancel/overflow icon into the always-visible peek row.
- ⬜ **`ride/[id]/page.tsx:172-179`** — "Message driver" is a raw `tel:` link; real phone numbers exposed both directions, no masked/proxy calling.
  Fix: route through a masked-call API (Exotel/Knowlarity) instead of raw `tel:`.
- ⬜ **`select-ride/page.tsx:310, 517-522`** — No-drivers-available (`allUnavailable`) is a dead end; no path to schedule-for-later or retry.
  Fix: surface a "Schedule this ride" CTA (the `PickupTimeChip` flow already exists) directly from the no-drivers banner.
- ⬜ **`search/page.tsx:596-613, 627-651`** — Heart (favorite) icons on autocomplete/popular-place rows have no `onClick` — decorative, reads as broken.
  Fix: wire to a "save as favorite" action or remove the icon.

### Driver side
- ⬜ **`TripRequestCard.tsx` / `App.tsx:196-235`** — Incoming request payload has no `pickupNote`/instructions field at all — a data-shape gap, not just UI.
  Fix: add `pickupNote`/`instructions` to the `ride:request` socket payload and render it in the card.
- ⬜ **`CollectCash.tsx:37-41`** — `confirmCustomAmount` accepts any non-negative float with no sanity bound vs. the quoted fare (e.g. a fat-fingered ₹500000 goes straight to the server).
  Fix: soft-confirm step when collected amount deviates from fare by >~20%.
- ⬜ **`NavigateToPickup.tsx` / `TripInProgress.tsx`** — Cancel confirmation never shows the driver any consequence (rating/acceptance-rate impact) before they commit.
  Fix: surface cancellation-rate impact in the confirm sheet if tracked server-side.
- ⬜ **`Home.tsx:136-149`** — `handleToggle`'s offline path doesn't check `activeRide` — a driver could go offline mid-trip via an edge-case double-tap/session-restore.
  Fix: block/warn the offline toggle whenever `activeRide` is non-null.
- ⬜ **`SwipeToConfirm.tsx:38-53`** — On a failed confirm (network error), the handle silently reverts after 1800ms with zero error message.
  Fix: surface a toast/inline error on the reset-without-advance path.
- ⬜ **`NotificationToast.tsx` + `TripRequestCard` overlay** — Toasts get z-index-occluded behind the full-screen incoming-request card with no queuing/pause — could be missed entirely.
  Fix: suppress/delay toast auto-dismiss while `incomingRequest` is active, or queue it.
- ⬜ **`NavigateToPickup.tsx:530`** — Rider phone shown unmasked before the trip has even started. **Verify with backend whether this is already proxied — could be P0 if raw and permanently retained.**
- ⬜ **`TripInProgress.tsx`** — Driver has zero live fare visibility during the trip; only sees the number after swiping "Complete Trip."
  Fix: surface a live running-fare estimate in the trip-in-progress sheet.

---

## P2 — polish backlog

- ⬜ Surge multiplier badge (`select-ride/page.tsx:657-661`) has no explanation of *why* or fare-lock confirmation.
- ⬜ `vehicle_color` exists in `RideDetail` but isn't rendered as a visual swatch/chip next to the plate.
- ⬜ "Booking for" rider name (`search/page.tsx` BookingForSheet) disappears after search — not shown on select-ride, tracking, or receipt.
- ⬜ "Change" payment button (`round-trip/page.tsx:339`, `rental/page.tsx:567`, `select-ride/page.tsx:763`) has no `onClick` at all — looks live, does nothing. At minimum wire a "Cash only for now" toast.
- ⬜ Searching state (`SearchingDots`) copy never changes past ~60s even if search is still running.
- ⬜ Rating screen (`rate/page.tsx:187-192`) shows no fare/ride recap before asking for stars.
- ⬜ Receipt's "Need help with this trip?" (`receipt/page.tsx:312-320`) routes to generic `/help` with no `rideId` context passed.
- ⬜ Wait-charge disclosure only shows for one-way detour stops (`select-ride/page.tsx:534-538`); round-trip and rental never show an equivalent policy line.
- ⬜ Post-completion/cancellation auto-navigation timers (2s/3s) aren't dismissible or pausable.
- ⬜ Trip-type comparison (one-way vs round-trip) shows price only, no time/effort trade-off guidance.
- ⬜ Dead driver route `/ride/incoming` still registered in the router, redirects to Home with no ride-context recovery.
- ⬜ External maps nav (`NavigateToPickup.tsx:543-550`, `TripInProgress.tsx:416-424`) hardcodes `maps.google.com`, no platform-detected deep link (`comgooglemaps://`, `waze://`) or fallback.
- ⬜ Free-wait timer (`TripInProgress.tsx:592-606`) only warns after the free window elapses — no "2 min left" pre-warning.
- ⬜ Cancellation reason codes (`NavigateToPickup.tsx:270-280`) lump most causes into `other` — missing `passenger_no_show`/`rider_requested`.
- ⬜ `StatusBar.tsx` and `WalletGateCard` independently poll the same wallet endpoint — duplicated fetch, not wrong but wasteful.
- ⬜ `TripRequestCard.tsx:64-80` `beep()` constructs a fresh `AudioContext` per request without ever closing it — minor leak risk on rapid repeat requests.
- ⬜ Incoming-request countdown ring has no numeric seconds label — only arc angle communicates urgency.
- ⬜ Multi-stop nav is one-leg-at-a-time with no compact "N stops left" summary chip in the instruction card.

---

## What's already good (don't touch)

**User app**
- Real-time tracking: socket-first with polling fallback, smoothed/interpolated driver position, road-snapped breadcrumb trail, client-ticking live ETA.
- Automatic ride-type reclassification (in-city vs outstation) with clear toast-and-redirect.
- SOS button persistent throughout active trip + stuck-ride self-report flow.
- Return Cab discount comparison ("Save ₹X vs standard").
- Strong fare transparency: itemized pre/post-trip breakdowns, live fare-drift toast, payment-retry flow.
- Multi-stop wait-timer badges mirroring the driver app's own meter.
- Resume-active-ride safety net on Home with retry-once fallback.

**Driver app**
- `SwipeToConfirm` for every safety-critical mid-drive confirmation — accident-resistant deliberate gesture.
- Countdown ring wrapping the Accept button — single visual object for timer + action.
- Manual "Arrived"/"Complete Trip" confirmation, never auto-completing on GPS proximity alone.
- SOS button consistently positioned, two-step confirm-then-send.
- Wallet-gating before "Go Online" surfaces payment blockers proactively.
- Hindi voice guidance + speed-alert system — above what most regional competitors ship.

---

## Next steps

Working phase by phase, starting with P0. Check items off (⬜ → ✅) as they land; update this file in place rather than creating a new doc per phase.
