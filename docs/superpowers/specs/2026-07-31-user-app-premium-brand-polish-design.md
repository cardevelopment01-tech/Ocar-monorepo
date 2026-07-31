# User App — Premium Brand Polish (Phase 1)

## Goal

Bring the user app's UI closer to the premium, glossy feel of the new logo mark, without switching the app to dark mode. The existing color tokens (`primary` teal `#0A9FB0`, `accent` pink `#DC3E93`, `gradient-primary`) already match the logo's palette — the gap is that this premium treatment (gradient, glow, glossiness) is only applied to `.btn-primary`, while most surfaces (cards, chips, bottom nav) are flat white with a plain shadow. This phase extends the existing premium language consistently and adds a signature glossy shine-sweep interaction that doesn't exist anywhere yet.

Map-heavy screens keep their light, functional UI as-is (no re-theme) — this is about elevating chrome/cards/buttons, not backgrounds.

## Non-goals

- No dark-mode reskin of the whole app.
- No change to map tile styling.
- No per-page bespoke redesigns beyond Home + BottomNav in this phase — other pages inherit automatically via shared `.btn-primary` / `.card` classes, and get a follow-up spot-check pass, not a rewrite.

## Changes

### 1. Home hero branding fix
`app/(main)/home/page.tsx` currently renders literal text `"ocar"` (lowercase, line ~288) in the hero top bar instead of the logo mark used everywhere else post-rebrand. Swap it for `<OcarLogoMark size="sm" />`, matching how login/splash already do it.

### 2. New premium primitives in `globals.css`

- **`.gloss-sheen`** — a `::after` pseudo-element utility: a diagonal white-ish gradient band that sweeps across the element on `:active`/tap via a CSS keyframe (`background-position` translate), clipped to the element's border-radius. Pure CSS, no JS, so it composes with any element (buttons, cards, chips) by just adding the class.
- **`.icon-badge-gradient`** — replaces flat-tint icon badges (currently `background: rgba(10,159,176,0.08)` inline) with a soft gradient wash (teal → pink at low opacity) plus a subtle inset highlight, giving icon badges more depth.
- **`.card-glossy`** — variant of `.card` with a hairline gradient border (teal→pink at low opacity via `border-image` or a padding-box/border-box double-background trick) and a soft top inner highlight, for cards that should feel "elevated" (service tiles, promo, resume-trip banner).

These are additive utility classes — existing `.card`, `.btn-primary`, `.btn-secondary` stay as fallback/default; call sites opt in to `-glossy`/`-gradient` variants where it matters (this phase: Home page).

### 3. Home page card treatments (`app/(main)/home/page.tsx`)

- Service tiles (One Way / Round Trip / City Rides): `.card` → `.card-glossy`, icon badge → `.icon-badge-gradient`, add `.gloss-sheen` on tap.
- Saved places / recent-trips list container: `.card-glossy`, icon badges → gradient.
- Popular-route chips: add `.gloss-sheen` on tap; keep pill shape.
- Promo card and resume-trip banner: already have custom dark/gradient backgrounds — add `.gloss-sheen` on tap for consistency, no structural change.

### 4. BottomNav active-tab upgrade (`components/ui/BottomNav.tsx`)

Replace the flat `bg-primary/10` active pill with a soft gradient pill (`bg-gradient-primary` at reduced opacity, e.g. via a translucent gradient background) plus a subtle glow shadow, still using the existing `layoutId` slide animation — only the pill's fill/shadow changes, not the interaction model.

### 5. Rollout note

`.btn-primary` and `.card` are shared globally, so pages like wallet, profile, history, select-ride etc. already inherit the base gradient button. After this phase lands, do a quick pass to swap plain `.card` → `.card-glossy` on the 1-2 most prominent cards per remaining page (e.g. wallet balance card, ride summary card) — tracked as follow-up, not built in this pass.

## Testing

Visual/manual only (this is UI polish, no business logic). Verify in dev server:
- Home page: hero shows logo mark not text; service tiles/saved-places/popular chips show gloss sheen on tap; no layout shift regressions.
- BottomNav: active tab shows gradient glow pill, tab switching animation unchanged.
- Reduced-motion: sheen respects `prefers-reduced-motion` (skip animation, keep static state) consistent with existing `useReducedMotion()` usage on this page.
