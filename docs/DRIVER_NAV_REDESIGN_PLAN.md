# Driver App — Navigation / Header Redesign Plan

**Status:** implemented (2026-07-27) — `StatusBar` is the single two-skin header with the Ember pill; Home's bespoke header deleted; Home earnings-glance chip shipped (§9). tsc clean, Vite serves; not yet screenshotted in the live gated app.
**Scope:** driver app top bar (header). Bottom tab bar is already unified — left as-is.
**Goal:** one coherent header *system* with two coherent skins, replacing the two divergent, drifted top-bar implementations that exist today.

---

## 1. The actual problem (diagnosis)

The complaint — "everything is random on each page, especially Home has no bar, just a logo and a side notification" — is a real structural defect, not a vibe. There are **two independent top-bar implementations that have drifted apart**:

| | **Home** (`pages/Home.tsx:314-351`) | **Earnings / Wallet / Profile** (`components/ui/StatusBar.tsx`) |
|---|---|---|
| Structure | Bespoke **floating islands** over the map (logo chip left; status pill + bell floating right) | Shared **solid fixed bar** |
| Height | ~48px safe-area float | fixed **56px** |
| Bell | 40px (`w-10`), `GLASS` token | 36px (`w-9`), `rgba(79,70,229,0.05)` tint |
| Logo | hand-rolled `O`+`car` text chip | `OcarLogoMark` component |
| Status pill | inline copy, `GLASS` border | inline copy, different rgba tokens |
| Extras | none | earnings ₹ + wallet-warning chip |
| Padding math | `max(env(safe-area)+12px, 48px)` | `pt-[64px]` on content |

Home **re-implements** the pill + bell that `StatusBar` already owns, and the two copies use different sizes and tokens. That duplication *is* the inconsistency. This is a shared-component problem: fix it once in one component, not four times per page.

**Bottom nav (`BottomNav.tsx`) is fine** — one component, consistent active state, already good. Do not touch it beyond token alignment. Note its `height: 60` is depended on by Home's map-sheet positioning math (see comment in file) — must stay 60.

---

## 2. Design direction (chosen)

**Reference pick:** Uber Driver's information architecture (status + earnings + alerts, nothing else) rendered with Airbnb's over-map chip treatment (near-opaque white chips, hairline border, soft ambient shadow) — because the real constraint is *drivers reading a phone on a dashboard mount in bright Odisha sun, one-handed*. Don't invent a new header IA for a livelihood tool; render the proven one better, in Ocar indigo.

**One component, two skins.** A single `StatusBar` component with a `surface: 'floating' | 'solid'` prop. Everything except the surface is identical across every screen.

### Shared (never varies)
- **56px** bar height, **16px** horizontal padding, single safe-area rule.
- **One bell**: 44×44 tap target (WCAG AA — PRODUCT.md's own rule; current 36/40px both fail or graze it), 20px icon, one badge treatment.
- **One status pill** component.
- **One z-layer**, one element order.

### Element order, left → right (both skins)
1. **Identity slot** — logo chip on Home; page title (Inter 600, 18px) on content pages. Same slot, same left edge.
2. *flex gap — nothing lives in the middle.*
3. **Earnings glance** — Home only. Compact `₹1,240` chip, tappable → `/earnings`. (Drivers check this compulsively; a header chip kills a whole navigation loop.)
4. **Status pill** — always second-from-right. The anchor.
5. **Bell** — always rightmost, always identical.

### What varies: only the surface
- **`floating`** (Home, over map): container `background: transparent`; glass lives **per-chip**, not as a full-width slab (a full glass bar would eat 56px of map and wash out in sun). Each chip is opaque-leaning.
- **`solid`** (Earnings/Wallet/Profile): one flat bar, `surface` white, 1px bottom hairline `border`. **No shadow until scrolled** — fade in a subtle `shadow-sm` only after `scrollTop > 0` (150ms linear).

### What is OUT of the header (be ruthless)
- **SOS stays out.** Safety must be reachable *during a ride*, one-handed, in the thumb zone — it already lives as `SOSButton` on `NavigateToPickup` / `TripInProgress`. Top-of-screen SOS a moving driver can't reach is safety theater. Leave it exactly where it is.
- No avatar (bottom nav owns Profile), no search, no hamburger, no settings gear, no back button on top-level screens.
- Anything tempting goes in a *screen*, not the chrome. This header is glanced at ~200×/day; every element is 200 extra parses.

---

## 3. Sunlight & premium treatment (the floating skin gets the budget)

- **Opaque-leaning glass, not glassmorphism.** Chips ≥ **85% white opacity** + `blur(12px)` as *finish*, not as the legibility strategy. The opacity does the work; the blur is jewelry. Standard 30–50% glass washes out completely over a bright map.
- Every floating chip: **1px inner border ≥ 60% white** + soft ambient shadow `0 2px 8px rgba(15,23,42,0.12)` — the shadow separates chip from map where color contrast dies in sun.
- Chip text: `ink-900` (`#0F172A`), never muted. Header minimum: **13px Inter 600**, nothing lighter than 500 in the chrome.
- **Status pill = the emotional anchor.** Hue unchanged (orange stays Online), but it gets a full material treatment — see **§8 "Ember"** for the detailed spec. Offline = solid slate. Badge stays red (distinct from the orange pill so the two never read as one signal).
- **Content skin stays flat and quiet** — its job is to disappear under the page title.

---

## 4. Micro-motion (restrained — opened 40×/day, frequency gate applies)

Global rule: nothing in the header animates > 400ms, nothing loops, nothing moves on scroll except the content shadow fade.

- **Online ↔ offline** (the one moment worth spending on): pill background cross-fades slate→ember (see §8), **300ms `cubic-bezier(0.2,0,0,1)`**; status dot single scale pulse `1→1.25→1` **once, 400ms** (no looping pulse — fatigue on a stared-at screen); label fade-through 120ms; one haptic tick. Going offline = same transition, **no pulse** (powering down is quieter).
- **Badge**: new notification → scale-in `0→1` slight overshoot **250ms spring (damping ~0.7)** + one bell tilt ±8° **300ms**, *on arrival only*. Count change = 100ms fade-swap. Never bounce on mount/navigation.
- **Variant transition** (map ↔ content nav): do **not** morph the header. Cross-fade *surface only* — bg/border opacity **150ms linear** — while pill and bell stay pixel-fixed in their slots (shared ordering is what makes this free). "The pill and bell never moved" IS the premium feel.
- All of the above respect `prefers-reduced-motion` → instant state swap, no pulse/tilt/spring. (Existing `useReducedMotion` pattern from `BottomNav.tsx`.)

---

## 5. Implementation

Root-cause, minimal-diff approach: **extend the existing `StatusBar` into the single header; delete Home's bespoke header.** Do not create a parallel component.

### Files
1. **`components/ui/StatusBar.tsx`** — the redesign lands here.
   - Add `surface: 'floating' | 'solid'` (default `'solid'`), optional `title?: string` (content pages), optional `earnings?: number` (Home).
   - Extract the status pill into a small local `StatusPill` (used by both skins — kills the duplication).
   - Extract chip tokens (opaque-glass chip vs solid) into two style constants at top of file.
   - Bell → 44×44 tap target, 20px icon, shared badge. Wire the arrival tilt/overshoot (guarded by `useReducedMotion`).
   - Keep the existing wallet-warning chip (Earnings/Wallet/Profile) — it's real and useful; render it only on `solid`.
   - Scroll-shadow: accept the page's scroll state or use an internal `IntersectionObserver`/`scroll` listener; fade `shadow-sm` in past 0.
2. **`pages/Home.tsx`** — delete the bespoke header block (`:314-351`), render `<StatusBar surface="floating" isOnline={isOnline} earnings={earningsToday} />`. Verify the map-sheet top offset still clears 56px (Home currently assumes ~48px float — re-measure the sheet snap points). Keep the `resumeRoute`/GPS banners below the header untouched.
3. **`pages/Earnings.tsx` / `Wallet.tsx` / `Profile.tsx`** — pass `surface="solid"` (or rely on default) + `title="Earnings" | "Wallet" | "Profile"`. Replace their `pt-[64px]` with a shared spacer constant so header height lives in one place.
4. **Motion values** → reuse existing `framer-motion` (already a dep). No new libraries.

### Order of work
1. Refactor `StatusBar` to the two-skin component + `StatusPill` extraction (solid skin first — 3 pages already use it, lowest risk). → verify: Earnings/Wallet/Profile look identical to today minus the pill color change.
2. Add `floating` skin + chip tokens. → verify in isolation over a screenshot of the map.
3. Swap Home to `<StatusBar surface="floating">`, delete bespoke block. → verify: sheet math, sunlight legibility (screenshot at high brightness), no map real-estate lost.
4. Wire online↔offline + badge + variant cross-fade motion, all `prefers-reduced-motion`-gated.
5. Full pass across all 4 tabs on 375px + notched device.

---

## 6. Decisions — resolved

1. **Online pill color — RESOLVED: keep orange.** Online stays orange (drivers know it); the only change is pale tint → **solid opaque orange** fill for sun legibility. Offline = solid slate. Notification badge stays red. No hue relearning.
2. **Scope — RESOLVED: 4 main tabs + token adoption.** Home/Earnings/Wallet/Profile get the full two-skin header. Immersive flows (`GoOnline/*`, `ActiveRide/*`, `Onboarding/*` via `OnboardingShell`) keep their contextual chrome (map+sheet / stepper — no standard top bar, by design) but **adopt the shared `StatusPill` / bell / back-button tokens** where they already surface those elements, so nothing drifts again. No forced 56px bar on immersive screens.

---

## 7. Accessibility checklist (gate before merge)
- [ ] Bell + all chips ≥ 44×44 tap target.
- [ ] Pill text ≥ 4.5:1 on its fill; chip text `ink-900` on ≥85% white.
- [ ] Online/offline conveyed by **text + fill + dot**, never color alone.
- [ ] `aria-current`, `aria-label` on bell, `role`/`aria-live` on badge count.
- [ ] All motion has a `prefers-reduced-motion` path (instant swap).
- [ ] 16px minimum for any body text; no `ink-400` on light.
- [ ] Verified at 375px and on a notched safe-area device.

---

## 8. Status pill — the "Ember" treatment (detailed)

The pill is the single most-read element in the app: it's the driver's livelihood-state switch, glanced at from a dashboard mount, at arm's length, in sun. A flat orange fill is the generic delivery-app move and it fails on two axes at once — see the tension below. "Ember" solves both.

### The concept: *ember, not safety-vest*
Online is not bright alert-orange (`#F97316` at full saturation reads as a promo banner or a hi-vis vest — cheap, loud, and it's the exact "OLA legacy aesthetic" our anti-references call out). Online is a **deep warm ember** — the pill looks *lit from within*, like a coal. Offline is **cold, dead slate**. The premium feeling doesn't live in either state; it lives in the **contrast between them** — going online is a visible "lights on" moment. This also carries the brand's warm/cool duality honestly: the app is **indigo** (calm, trust, brand); when you're *live and earning*, you glow **ember**. That's a small story, not just a color swap — and it's distinctly Ocar, not a generic status chip.

### Two problems a flat fill ignores (both push the same direction: go deeper)
1. **Contrast.** White text on `#F97316` (orange-500) is ≈ **2.3:1 — fails AA badly**. White only reaches AA (4.5:1) around orange-800 (`#9A3412`). So a legible white-on-orange pill *must* be deep anyway.
2. **Premium.** Bright saturated orange reads cheap/promo. Deep ember (burnt orange → the coal end of the ramp) reads *expensive*. The accessible answer and the premium answer are the same answer.

### The gradient-for-contrast trick (this is the craft)
A single vertical gradient does double duty — dimensionality **and** legibility:
- **Top edge** stays bright (`#FB923C`/`#F97316`) for ~15% of height → this is the "lit" sheen, the highlight that makes it read as a physical, glowing object.
- **Body under the text** sits deep (`#C2410C → #9A3412`) → the glyphs ride the dark band, so **white text passes 4.5:1**.

Result: it *looks* like vibrant lit orange (bright sheen up top) while the text is actually on burnt ember. Premium sheen, accessible text, one gradient.

```
Online fill:  linear-gradient(180deg,
                #FB923C 0%,     /* lit top sheen */
                #EA580C 22%,
                #C2410C 60%,    /* text rides here down */
                #9A3412 100%)   /* deep ember base */
```

### Full token spec

| Element | Online (Ember) | Offline (Cold) |
|---|---|---|
| Fill | ember gradient above | flat `#1E293B` (slate-800) |
| Inner top highlight | `inset 0 1px 0 rgba(255,255,255,0.28)` (the lit edge) | none |
| Ambient glow (the tell) | **hue-matched**: `0 2px 10px -1px rgba(234,88,12,0.42), 0 1px 3px rgba(154,52,18,0.35)` — orange glow, never gray | none (or `0 1px 2px rgba(15,23,42,0.15)`) |
| Dot | 6px, white core `#FFFFFF` + 1.5px outer ring `rgba(255,255,255,0.35)` — a "live" indicator, not a flat dot | 6px, flat `#64748B` (slate-500), no ring |
| Label | "Online", white, Inter **700, 12px**, tracking `0.02em`, `text-shadow: 0 1px 1px rgba(124,45,18,0.45)` (depth + legibility lift) | "Offline", `#CBD5E1` (slate-300), Inter 600, 12px |
| Padding / shape | `4px 12px`, fully rounded (`999px`), height ~28px | same (identical geometry — only the skin changes) |

### Motion (one-shot only — respects §4 frequency gate)
- **Offline → Online:** fill cross-fades slate → ember **300ms `cubic-bezier(0.2,0,0,1)`**; the hue-matched glow fades in over the same 300ms (this is what sells "lit up"); the dot's outer ring does a **single** expand-and-fade pulse (`scale 1→2.2`, `opacity 0.35→0`, **500ms ease-out, once**); label fade-through 120ms; one haptic tick.
- **Online → Offline:** same fill/glow cross-fade, **no ring pulse** — powering down is quieter than powering up.
- **No looping pulse while online.** A pill a driver stares at all day must not breathe — that's fatigue, not delight. The ember is *static* premium; the life is spent entirely on the transition.
- `prefers-reduced-motion`: instant fill/glow swap, no ring pulse.

### Sunlight check
Deep ember holds far better than bright orange over a washed-out map (deeper fill = more luminance separation from a bright, glare-blown background); the hue-matched glow gives the pill a soft edge halo that separates it from the map even when color contrast collapses in direct sun. White-on-ember at 12/700 is the legible pairing; bright-orange-with-white (the flat version) would be illegible in exactly the conditions drivers use this in.

### Lighter alternative (if Ember feels too heavy over the map)
**"Frost-ember"** — the *floating* skin keeps the near-opaque white chip (§3) and expresses Online as a **warm ring + warm dot** instead of a full orange fill: white chip, `2px` inner ring in ember-orange, ember dot, `ink-900` "Online" text. Keeps the map maximally visible and stays consistent with the other floating chips (they're all white). Trade-off: quieter, less of an "anchor" — the full Ember pill is the stronger emotional signal and the recommendation; Frost-ember is the fallback if usability testing says the solid pill fights the map.

### A11y gate (pill-specific — add to §7)
- [ ] Verify white on the fill **under the glyphs** (not the bright top sheen) ≥ 4.5:1 with a contrast checker; deepen the `60%→100%` gradient stops until it passes.
- [ ] Online/offline conveyed by **fill + dot + label** together — never color alone (already true).
- [ ] Glow is decorative only — never the sole carrier of state.

---

## 9. Home earnings glance — implemented (2026-07-27)

Today's earnings now anchors the **top-left** of Home's floating header, displacing the logo (the logo still lives on the three solid-bar tabs; Home is the one screen where the driver's money outranks the brand — matches Uber Driver's map). Reversible: swap `EarningsChip` back for the logo chip in `StatusBar.tsx`.

**Content:** `₹1,240 · 4 trips` — full rupees, Indian grouping (`toLocaleString('en-IN')`), **never abbreviated** (drivers reconcile against cash; ₹1.2k destroys trust). `tabular-nums` so digits don't jitter. Green ₹ glyph (`#047857`, AA-safe) + near-black digits (`#0F172A`, most sun-legible) + muted trips suffix (`#475569`). Trips hidden at 0. Reference: Robinhood's header ticker minus the colour drama.

**Data (reuse, no new backend):** `driverRideApi.getEarningsSummary('today')` → `total_earnings` + `trip_count`, mirroring Profile's exact pattern. Fetched on every Home mount (Home remounts on return from a ride → always fresh).

**Persistence & motion (the craft):** last value lives in `useSessionStore` (persisted, *not* cleared on offline). The chip's motion value seeds from it, so:
- **No reflow / no ₹0 flash** — the real value renders instantly on mount; ₹0 is shown honestly when nothing's earned yet.
- **Count-up only on a real increase** — a cold mount where fetched === cached produces zero motion; the value rolls (500ms, `cubic-bezier(0.16,1,0.3,1)`) only when today's total actually grew. Never rolls from ₹0. A 600ms 10%-green wash acknowledges the gain. All `prefers-reduced-motion`-gated (instant set, no wash).

**States:** online-earned / offline-earned render identically (money doesn't gray out when you go offline); ₹0 always shown; persisted value covers the "loading" moment so there's no shimmer needed.

**Deliberately skipped (ponytail):** full per-digit odometer (a value count-up reads the same at 15px for 1/5 the code) and a dedicated earnings store (extended the already-persisted session store instead). Add the odometer only if the count-up ever looks cheap in the hand.
