# Rental Packages Tab — City-Scoped View Design

## Problem

The Rental Packages tab (`apps/admin/app/(dashboard)/config/rate-cards/page.tsx`, "Rental Packages" tab) currently lists every package row — global and city-override — in one flat table grouped only by vehicle category, distinguished by a small "Global"/city-name pill per row. This was fine with zero overrides, but now that per-city overrides exist (see `docs/superpowers/plans/2026-08-06-city-wise-rental-packages.md`), it reads as a jumbled mix and will only get worse as more cities get overrides — the admin has to visually filter a flat list to answer "what does Puri actually charge?"

The city list is expected to grow to dozens over time, and most cities will have zero overrides at any given moment. The redesign must stay clean under that shape (few overrides, many cities with none), not just look nicer with today's small dataset.

## Goal

Redesign the Rental Packages tab so an admin can answer two questions at a glance, without mentally filtering a mixed list:
1. "What's the global default pricing?"
2. "What does city X actually charge, and which of its tiers are city-specific?"

Scope: **Rental Packages tab only.** Rate Cards has the same global/city mixing pattern but is out of scope for this pass (smaller row count today, lower priority, flagged as a likely future follow-up rather than bundled in).

## Design

### 1. City switcher (replaces flat grouped table)

A single-select control at the top of the Rental Packages tab, above the per-category tables, using Radix `DropdownMenu` (already used in `AdminTopBar.tsx` — reuse that styling, don't invent a new dropdown pattern). Options:
- **🌐 Global Defaults** (default selection on tab load)
- One entry per active city (`cities.filter(c => c.status === 'active')`, same source as every other city list on this page)

Selecting an option re-renders the category-grouped tables below to show **that context's effective pricing**:
- **Global Defaults selected:** shows every global tier (`city_id IS NULL`), exactly like today minus the interleaved city rows.
- **A city selected:** for every tier that exists in Global Defaults, shows that city's **effective** price — its own override if one exists for that `(category, duration_minutes, km_limit)`, the global price otherwise. This is the same merge-by-tier fallback the public booking API already implements (`getRentalPackagesByCategory` in `api/src/modules/pricing/pricing.repository.ts`) — the admin UI should call the *admin* list endpoint with a `city_id` filter that does the equivalent merge (see Data Flow below), not reimplement fallback logic differently in two places.

Rationale for switcher over "two stacked sections" (the alternative explored and rejected during brainstorming): with dozens of cities, showing every city's overrides simultaneously (even collapsed) adds scroll and chrome for a tab where most cities contribute nothing. One focused context at a time scales flat regardless of city count.

### 2. Row states, badges, and actions

Every row in the category-grouped tables is in exactly one of two states, determined by whether a real DB row exists for `(category_id, duration_minutes, km_limit, selected_city_or_null)`:

**Inherited** (only possible when a city is selected, never when viewing Global Defaults):
- Price shown = the global tier's price.
- Status badge: muted pill, text "Inherited" (reuse `.pill-muted`).
- Single action: **"+ Add override"** — a distinctly green, outlined button (not the neutral pencil), pre-filled with the tier's global values (`duration_minutes`, `km_limit`, `package_fare`, `extra_per_km`, `extra_per_min`) and `city_id` locked to the currently-selected city. Saving inserts a new row; it does NOT touch the global row.

**Override** (a real row exists — either a global row when viewing Global Defaults, or a city-specific row when viewing a city):
- Status badge: `.pill-info` with the city name when viewing a city context ("Puri override"); no badge needed when viewing Global Defaults (every row there is definitionally the global default).
- Two actions: **Edit ✎** (opens the same form pre-filled with this row's own values, updates in place) and **Delete** (removes this specific row).
  - Deleting a **city override** row reverts that tier to Inherited for that city (global reappears) — this is the expected, desired behavior, not a bug to guard against.
  - Deleting a **global** row while a city has an override for that same tier is a real edge case: the city's override row is untouched (it's a separate DB row), but that tier disappears entirely from Global Defaults and from any city that was inheriting it. This is existing, unavoidable behavior of the data model (not new) — no special UI treatment needed beyond the existing delete-confirmation dialog already in place.

This state model directly resolves the interaction ambiguity raised during brainstorming: clicking "Edit" never silently creates an override — creation only ever happens through the explicitly-labeled "+ Add override" action.

### 3. Create dialog — unchanged mechanics, one convenience default

"New Package" keeps its existing behavior and its own City field exactly as implemented in the current per-city rollout (mirrors Rate Cards' and Surge Events' create dialogs, which already have their own independent City selectors) — **do not** make it context-aware of the switcher's current selection in any functional way. The only change: the dialog's City field defaults to whichever city is currently selected in the switcher (or "All Cities / Global Default" if Global Defaults is selected), purely as a starting value the admin can still change. This was explicitly requested to stay simple and consistent with the existing Rate Cards/Surge Events pattern rather than gaining new conditional behavior.

### 4. Visual polish

Reuse this app's existing tokens and patterns — no new colors, shadows, or animation libraries introduced:
- City switcher open/close and the table-content swap on selection change use `framer-motion` with the same easing already established in `SlideOver.tsx`/`NotificationToast.tsx`: `transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}`, wrapped in `AnimatePresence`, respecting `useReducedMotion()`.
- Rows fade/stagger in on a context switch (small `delay` per row index, capped so it never feels sluggish with many rows) rather than a hard re-render/flash.
- Card/table chrome stays on existing `.admin-card`, `.data-table`, `.shadow-card` / `.shadow-hover` tokens.
- A small header stat line under the switcher: `"Puri · 1 of 6 tiers overridden"` (computed client-side from the fetched rows: count of Override rows / total tiers) for at-a-glance context without reading the whole table.
- Delete uses the existing `ConfirmDialog` component already used elsewhere on this page (rental package delete already does this today — unchanged).

### 5. Empty states

- A city with zero overrides: every row shows Inherited + "+ Add override". No special empty-state banner needed — this *is* the normal, expected state for most cities most of the time, and the header stat line ("Puri · 0 of 6 tiers overridden") already communicates it passively.
- Global Defaults with zero packages for a category: unchanged from today's existing empty-category handling.

## Data Flow

**New/changed API surface (admin-only, `/api/v1/admin/pricing/rental-packages`):**

The existing `listAdminRentalPackages()` (`api/src/modules/admin/admin.repository.ts`) currently returns every row unfiltered, with raw `city_id`/`city_name` per row — this is what feeds today's flat, interleaved table. This endpoint needs a mode that returns **effective, per-tier** rows for a given context (global or a specific city), matching the fallback semantics the public listing endpoint already implements, so the admin UI doesn't reimplement merge logic client-side against raw rows for every category:

- `GET /api/v1/admin/pricing/rental-packages?city_id=<id>` → for each `(category_id, duration_minutes, km_limit)` tier across ALL categories, one row: the city's own row if it exists for that tier, else the global row, tagged with whether it's `is_override: boolean` (or equivalently, whether the returned row's `city_id` matches the requested `city_id`) so the frontend can render Inherited vs Override without re-deriving it.
- `GET /api/v1/admin/pricing/rental-packages` (no `city_id`) → **behavior change from today.** The endpoint currently returns every row unfiltered (global + every city override, interleaved) — that's the exact flat/mixed response the UI is being redesigned to stop consuming directly. Under this design, no-`city_id` means "Global Defaults" and should return only `city_id IS NULL` rows. This is a deliberate, breaking change to an already-shipped endpoint's default response shape, not new behavior on a blank slate — call it out explicitly in the implementation plan/PR description so it isn't mistaken for an accidental regression. The only consumer of this endpoint today is this same admin page, so there's no other caller to break.

This is a genuinely new repository query (admin-scoped equivalent of the public `getRentalPackagesByCategory` merge, but across all categories at once and tagged with an explicit override flag) for the `city_id`-present case — not a reuse of the existing unfiltered `listAdminRentalPackages()`. The no-`city_id` case is a narrowed version of the existing query (add `WHERE city_id IS NULL`), not a new query. Exact SQL shape is an implementation-plan detail, not a design-level decision.

**Frontend:** `rentalPackageApi.list()` in `apps/admin/lib/pricing-api.ts` gains an optional `cityId` argument, threaded through to the new query param. The page component's existing `cities` state (already fetched for Rate Cards) drives both the switcher's options and the create dialog's default, as it already does for Rate Cards' equivalent city selector.

## Error Handling

No new error classes. Existing patterns apply unchanged:
- "+ Add override" / "Edit" submit through the existing `rentalPackageApi.create`/`update` calls (already validate `city_id` server-side per the prior per-city-pricing change) — same inline dialog error message pattern already in place.
- Delete uses the existing `ConfirmDialog` + existing 409-on-FK-referenced-package handling (already implemented for the flat table's delete action) — unchanged.
- Switching cities is a pure client-side re-fetch; a failed fetch shows the same retry-button empty state pattern already used elsewhere on this page (`error` state + "Retry" button, see the Rate Cards tab's existing `error`/`retry` handling for the pattern to mirror).

## Testing

This module (`pricing`, `admin`) has no existing test files (`api/src/modules/pricing/**/*.test.ts` and `api/src/modules/admin/**/*.test.ts` both return zero matches) — consistent with the rest of this codebase's convention for these two modules. This change doesn't warrant introducing a new test harness on its own (UI + one new repository query, following an already-verified fallback pattern). The one new repository query (admin effective-pricing-per-tier merge) is the only piece with real logic risk; it should get the same live-DB manual verification treatment the prior per-city-pricing plan used for its equivalent public-endpoint query (create a real override, confirm the admin list reflects it correctly with and without `city_id`, clean up test data) rather than a written test, matching existing project convention.

## Out of Scope

- Rate Cards tab's identical global/city mixing (flagged, not bundled — separate future pass if requested).
- Any change to the public-facing (rider) rental package listing or booking flow — already city-scoped from the prior plan, untouched here.
- Bulk/multi-city override management (e.g. "copy this override to 5 other cities") — no requirement surfaced for it.
