---
name: Ocar
description: Intercity cab booking for Odisha — reliable, efficient, local.
colors:
  primary: "#4F46E5"
  primary-dark: "#4338CA"
  primary-bright: "#6366F1"
  primary-light: "#C7D2FE"
  primary-subtle: "#EEF2FF"
  accent-violet: "#7C3AED"
  accent-violet-light: "#EDE9FE"
  accent-orange: "#F97316"
  accent-orange-light: "#FFF7ED"
  bg: "#F5F7FF"
  surface: "#FFFFFF"
  surface-2: "#F5F7FF"
  surface-3: "#EEF0FF"
  ink-900: "#0F172A"
  ink-600: "#475569"
  ink-400: "#94A3B8"
  ink-inverse: "#FFFFFF"
  border: "#E8EEFF"
  border-light: "#F1F5FF"
  success: "#10B981"
  success-light: "#D1FAE5"
  warning: "#F59E0B"
  warning-light: "#FEF3C7"
  error: "#EF4444"
  error-light: "#FEE2E2"
  info: "#0EA5E9"
  info-light: "#E0F2FE"
  splash-bg: "#0F0D1A"
typography:
  display:
    fontFamily: "Inter, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Inter, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.4
  caption:
    fontFamily: "Inter, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  "2xl": "24px"
  "3xl": "32px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  "2xl": "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.full}"
    padding: "16px 24px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  button-primary-active:
    backgroundColor: "{colors.primary-dark}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.full}"
    padding: "16px 24px"
  button-go-online:
    backgroundColor: "{colors.accent-orange}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.2xl}"
    padding: "16px 24px"
  button-driver-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.2xl}"
    padding: "16px 24px"
  button-danger:
    backgroundColor: "{colors.error}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.2xl}"
    padding: "12px 20px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.2xl}"
  input:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.xl}"
  chip-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.full}"
  chip-inactive:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-600}"
    rounded: "{rounded.full}"
  status-pill-success:
    backgroundColor: "{colors.success-light}"
    textColor: "{colors.success}"
    rounded: "{rounded.full}"
  status-pill-warning:
    backgroundColor: "{colors.warning-light}"
    textColor: "{colors.warning}"
    rounded: "{rounded.full}"
  status-pill-error:
    backgroundColor: "{colors.error-light}"
    textColor: "{colors.error}"
    rounded: "{rounded.full}"
  nav-item-admin:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-400}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  nav-item-admin-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ink-inverse}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
---

# Design System: Ocar

## 1. Overview

**Creative North Star: "The Reliable Route"**

Ocar's visual system is built around a single principle: reliability made visible. Every radius, shadow, and color decision signals that this product was made for the people of Odisha — not adapted from a global template and dropped in. The aesthetic is confident without being loud. Indigo punctuates, it does not flood. Surfaces are clean and purposeful; there is no decoration that does not reduce cognitive load.

This system explicitly rejects two traps. First: the generic SaaS-indigo template — the gradient-text hero, the white card grid with eyebrow labels, the full-saturation primary plastered across 60% of every screen. Ocar's indigo is used sparingly enough that its appearance means something. Second: the legacy Indian cab app aesthetic — cluttered, low-contrast, banner-heavy, with a primary action buried three scrolls down. On Ocar, the primary action on any screen is unmissable.

The three apps share one visual grammar but serve three different contexts. The user app is mobile, in-transit, possibly one-handed. The driver app is mobile, outdoor, in-motion. The admin portal is desktop-primary, task-dense, information-rich. Motion is purposeful across all three: 150–250 ms for state changes, never choreography for its own sake.

**Key Characteristics:**
- Indigo-tinted ambient shadows — brand color in the shadow, never neutral gray
- Full-pill buttons for user CTAs; 2xl-rounded for driver CTAs; never mixed on the same screen
- Inter carries all type — one family, multiple weights, no display/body pairing
- Orange (#F97316) is operational, never decorative — driver and admin only
- `prefers-reduced-motion` respected everywhere, including the brand splash screen

## 2. Colors: The Confident Indigo Palette

A restrained palette anchored by one saturated indigo. The accent only appears where it earns its place.

### Primary
- **Confident Indigo** (`#4F46E5`): The brand anchor. Used on primary CTAs, active nav items, the brand mark gradient, active states, and focus rings. Never used decoratively or on more than 25% of any screen surface.
- **Indigo Deep** (`#4338CA`): Hover/pressed state for primary elements. Provides visible depth without adding a new color to the system.
- **Indigo Bright** (`#6366F1`): Gradient endpoint and highlight. Used as the lighter stop in the brand logomark arc gradient.
- **Indigo Light** (`#C7D2FE`): Tinted fills for info chips, selected state backgrounds, and focus overlays at low opacity.
- **Indigo Subtle** (`#EEF2FF`): The faintest indigo tint. Used for selected list items, hover backgrounds on nav items, and light-mode chip fills.

### Secondary
- **Arc Violet** (`#7C3AED`): The gradient partner to Confident Indigo. Used exclusively in the brand logomark arc (gradient endpoint) and the splash screen glow. Not used as a standalone UI color.
- **Violet Light** (`#EDE9FE`): Pale violet tint for secondary info surfaces when a second accent color is needed (rare; prefer indigo-subtle first).

### Tertiary — Operational Orange
- **Go-Online Orange** (`#F97316`): Driver and admin apps only. Signals the driver's active/online state, go-online CTA, and operational alerts in the admin portal. Never appears in the user-facing booking or tracking flow — its absence there is intentional. Orange means "operational layer."
- **Orange Light** (`#FFF7ED`): Pale fill for orange-adjacent badges and highlights in driver/admin contexts.

### Neutral
- **Background** (`#F5F7FF`): The indigo-tinted near-white used as the page background in the user and driver apps. The tint (≈0.008 chroma toward indigo) prevents the surface from reading as a generic default white.
- **Surface** (`#FFFFFF`): Cards, sheets, modals, and any elevated surface that sits above the background.
- **Surface 2** (`#F5F7FF`): Input backgrounds, secondary cards, and list items at rest — same value as Background, which creates flush groupings without a visible card edge.
- **Surface 3** (`#EEF0FF`): Stronger indigo-tinted fill for selected states, active tabs, and highlighted rows.
- **Ink 900** (`#0F172A`): Primary text — headlines, body, labels. Near-black with a cool undertone.
- **Ink 600** (`#475569`): Secondary text — supporting labels, metadata, form hints. Passes 4.5:1 on white.
- **Ink 400** (`#94A3B8`): Muted text — placeholders, disabled labels, nav items at rest. Use on white/surface only — verify contrast against any tinted bg.
- **Border** (`#E8EEFF`): Default border with an indigo tint — separates surfaces without adding visual weight.
- **Border Light** (`#F1F5FF`): The lightest divider, for internal row separators inside cards.
- **Splash Background** (`#0F0D1A`): The near-black used only on the brand splash screen. A deep indigo-dark that lets the gradient logomark glow.

### Semantic
- **Success** (`#10B981`) on **Success Light** (`#D1FAE5`): Completed rides, verified status, positive earnings.
- **Warning** (`#F59E0B`) on **Warning Light** (`#FEF3C7`): Pending states, time-sensitive conditions.
- **Error** (`#EF4444`) on **Error Light** (`#FEE2E2`): Failed payments, form errors, disputes.
- **Info** (`#0EA5E9`) on **Info Light** (`#E0F2FE`): Neutral informational states, trip details.

### Named Rules
**The Indigo Shadow Rule.** Every shadow in the Ocar system is tinted with `rgba(79,70,229,X)`. Never neutral gray. The brand color in the shadow unifies the three apps even when the surface itself is neutral white. If you reach for `rgba(0,0,0,X)` on a shadow, replace it.

**The Route Rule.** Primary (`#4F46E5`) appears on ≤25% of any screen. Its saturation is the punctuation, not the sentence. A screen where indigo is everywhere is a screen where nothing is primary.

**The Orange Boundary Rule.** Orange (`#F97316`) is operational. It means: driver going online, admin alert, active session. It does not mean "accent on the user booking flow." One misplaced orange on the user app breaks the system's trust language.

## 3. Typography

**Display / Body / Label Font:** Inter (system fallback: `system-ui, -apple-system, sans-serif`)

**Character:** A single family across all three apps. Inter's geometric skeleton reads technical precision; its humanist details keep it warm enough for a local service. One font, multiple weights — no decorative pairing, no display/body contrast axis. The hierarchy is carried entirely by weight and size.

**Known Divergences:** The driver app currently loads Poppins for some headings; the admin app loads DM Sans. Both are legacy artifacts. All new work uses Inter. Existing divergences should be resolved at the next refactor pass per the user's direction.

### Hierarchy
- **Display** (700, 28px, lh 1.2, ls -0.03em): Screen-level titles and the brand wordmark. Appears once per screen maximum. Used in the splash screen wordmark and auth page headlines.
- **Headline** (700, 22px, lh 1.3, ls -0.02em): Section headers, modal titles, ride-card primary labels. Tight tracking distinguishes this from body weight without requiring a font change.
- **Title** (600, 18px, lh 1.4): Card titles, list item primaries, navigation labels. The workhorse between Display and Body.
- **Body** (400, 16px, lh 1.6): All prose text, descriptions, supporting content. Minimum size for any reading-length string. Cap line length at 65–75ch on prose; data-dense admin tables may run denser.
- **Label** (500, 13px, lh 1.4): Form labels, status chips, metadata pairs, table column headers. Never tracked all-caps — Ocar does not use eyebrow text.
- **Caption** (400, 12px, lh 1.5): Timestamps, fine-print, secondary metadata under a primary label. Use sparingly; do not use for anything the user needs to act on.

### Named Rules
**The One Font Rule.** Inter carries all three apps. Introducing a second family — even a complementary one — fragments the visual system across three separate codebases that already diverge. If a screen needs hierarchy emphasis, use weight (400→600→700) and size, not a typeface swap.

**The No Eyebrow Rule.** Ocar does not use small-caps tracked eyebrow labels above section headings. The primary action is the label. Supporting context uses Label weight (500, 13px) as plain text, not as a decorative typography treatment.

## 4. Elevation

Ocar uses a **tonal ambient shadow system** — every shadow is an indigo-tinted ambient glow, never a sharp directional drop shadow. Elevation signals context and focus, not simulated 3D depth. At rest, most surfaces carry only the card shadow. Sheets and modals carry stronger shadows that mark them as temporarily elevated surfaces the user must interact with.

The splash screen is the single exception: it sits on the darkest possible surface (`#0F0D1A`) with an ambient radial indigo glow — a special-case elevation that exists outside the three-app system.

### Shadow Vocabulary
- **Card** (`box-shadow: 0 2px 16px rgba(79,70,229,0.07)`): Default card on the user app. Barely perceptible at rest; enough to separate the card from the background on the tinted near-white surface.
- **Card Admin** (`box-shadow: 0 1px 3px rgba(15,23,42,0.05), 0 4px 20px rgba(79,70,229,0.06)`): Two-layer shadow for the admin portal's denser tables and panels. The first layer (slate-tinted) provides structural separation; the second (indigo) preserves brand character.
- **Button Primary** (`box-shadow: 0 4px 20px rgba(79,70,229,0.40)`): Applied to the indigo CTA in the user app. The shadow is the visual affordance that the button is the primary action. It lifts the button off the surface without the button moving.
- **Button Go-Online** (`box-shadow: 0 4px 14px rgba(249,115,22,0.35)`): Orange ambient shadow for the driver go-online CTA. Matches the button's accent color.
- **Sheet** (`box-shadow: 0 -6px 32px rgba(79,70,229,0.10)`): Applied to bottom sheets in user and driver apps. Directional (upward) to separate the sheet from the scrollable content behind it.
- **Float** (`box-shadow: 0 4px 20px rgba(79,70,229,0.12)`): For floating action chips, the location search bar when active, and the trip-type selector.
- **Glow** (`box-shadow: 0 6px 32px rgba(79,70,229,0.35)`): Used on focus rings and hover states of primary elements in the admin portal. Stronger presence signal for desktop contexts.
- **Splash Glow** (radial-gradient ellipse, `rgba(79,70,229,0.22)`, CSS not box-shadow): The ambient indigo radial gradient behind the logomark on the splash screen. Not a shadow in the CSS sense; carries the same brand-color-as-depth principle.

### Named Rules
**The Indigo Shadow Rule** (carries forward from Colors): every shadow uses `rgba(79,70,229,X)` as the color component. Neutral `rgba(0,0,0,X)` shadows are not part of this system.

**The Flat-by-Default Rule.** Interactive elements are flat at rest. The shadow appears on the primary CTA to mark it as primary — not on every card or every button. Shadow is a priority signal, not a surface treatment.

## 5. Components

Ocar's component vocabulary is conservative. The same button shape appears consistently across each app. Standard affordances are used for standard tasks.

### Buttons

**Character:** Full-pill on the user app (trust, completion, forward motion). Rounded-2xl on the driver app (confidence, physicality). Never mixed on the same screen.

- **Shape (user):** `border-radius: 9999px` (pill). Full-width on booking CTAs.
- **Shape (driver):** `border-radius: 24px`. Full-width on CTA rows.
- **Primary (user):** Indigo-to-violet gradient (`linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)`), white text, `font-weight: 600`, Button Primary shadow. Hover: shadow intensifies. Active: `scale(0.98)`, shadow reduces.
- **Primary (driver):** Same gradient. `border-radius: 24px`. Same shadow rule.
- **Go-Online:** Orange gradient (`linear-gradient(135deg, #FB923C 0%, #F97316 100%)`), white text, `font-weight: 700`, Button Go-Online shadow. Driver app only.
- **Secondary:** White surface, Ink 900 text, Border color ring (`border: 1px solid #E8EEFF`), no shadow. Used for back/cancel/skip actions.
- **Danger:** Error color (`#EF4444`), white text, `border-radius: 24px`. Admin and safety flows only.
- **Disabled:** `opacity: 0.50`, `cursor: not-allowed`. All variants.

### Cards

- **Shape:** `border-radius: 24px` (2xl). White surface (`#FFFFFF`).
- **Shadow:** Card shadow (`0 2px 16px rgba(79,70,229,0.07)`) on the user app. Card Admin shadow on the admin portal.
- **Padding:** `16px` internal padding standard. Content-dense admin rows use `12px 16px`.
- **Anti-pattern:** Nested cards are never used. A card inside a card means the outer structure is wrong.

### Inputs

- **Shape:** `border-radius: 20px` (xl). Background `#F5F7FF` (Surface 2). Border `1px solid #E8EEFF`.
- **Focus:** `border-color: #4F46E5`, `box-shadow: 0 0 0 3px rgba(79,70,229,0.10)`. The focus ring uses the brand color at low opacity — no separate "focus blue."
- **Placeholder:** Ink 400 (`#94A3B8`). Passes 3:1 against Surface 2; verify if background changes.
- **Error state:** `border-color: #EF4444`, error message in Ink 600 below the input — never red text alone as the only indicator.

### Status Pills / Chips

- **Shape:** `border-radius: 9999px` (full pill). Horizontal padding `10px`, vertical `2px`. `font-size: 12px`, `font-weight: 600`.
- **Success:** `#D1FAE5` bg, `#10B981` text.
- **Warning:** `#FEF3C7` bg, `#F59E0B` text.
- **Error/Danger:** `#FEE2E2` bg, `#EF4444` text.
- **Info:** `#E0F2FE` bg, `#0EA5E9` text.
- **Muted:** `#F5F7FF` bg, `#94A3B8` text. For inactive/unknown states.
- **Selected Chip (filter/tab):** Primary bg, white text. Unselected: Surface 2 bg, Ink 600 text. Never use a border to mark selection — use background fill.

### Bottom Sheets (User and Driver)

- **Shape:** `border-radius: 32px 32px 0 0` (3xl, top corners only). White surface.
- **Shadow:** Sheet shadow (`0 -6px 32px rgba(79,70,229,0.10)`) — directional upward.
- **Handle:** 40×4px pill, `rgba(79,70,229,0.15)` color, `border-radius: 9999px`, centered at `margin: 12px auto 16px`.
- **Drag behavior:** Handle is the visual affordance for dragging. The handle color tints with the brand indigo at very low opacity rather than being neutral gray.

### Admin Navigation

- **Shape:** `border-radius: 12px` (md). Full-bleed within the sidebar column.
- **At rest:** Surface background (transparent), Ink 400 text, icon same color.
- **Hover:** Surface 2 background (`#F5F7FF`), Ink 600 text.
- **Active:** Primary background (`#4F46E5`), white text, white icon.
- **Typography:** Label size (13px, 500 weight). No icon-only nav items — always paired with a text label.

### Data Tables (Admin)

- **Row height:** 48px minimum. Rows are never short enough to fail touch targets (44px minimum).
- **Header:** Label size (13px, 600), Ink 600 color, `background: #F5F7FF`, `border-bottom: 1px solid #E8EEFF`.
- **Row:** Body size (14px, 400), Ink 900. Hover: `background: #F5F7FF` (no elevation change).
- **Pagination:** Label size, Ink 600. Active page: Primary color, no background (text-primary is enough).

### Brand Logomark (OcarLogoMark)

- **Ring:** 270° arc path `M 78.284 78.284 A 40 40 0 1 0 21.716 78.284`, `stroke-width: 7.5`, `stroke-linecap: round`. Gradient: `#4F46E5` → `#7C3AED`.
- **Dot:** `cx=78.284 cy=78.284 r=8`. Same gradient. Sits at the open end of the arc — the "speed ring" visual.
- **Wordmark:** "ocar" lowercase, Inter 700, `letter-spacing: -0.03em`, `font-size: 22px`. Color: Ink 900 on light surfaces, white on dark.
- **Sizes:** sm (20px ring), md (28px), lg (40px), xl (64px).
- **Variants:** `color` (gradient, default), `white` (solid white stroke/fill), `mono` (Ink 900 stroke/fill).

### Ocar Spinner (OcarSpinner)

A comet-taper arc — 120° rotating arc with a gradient from opaque head to transparent tail. Not the logomark reused; a purpose-built loading indicator.

- **Arc path:** `M 50 10 A 40 40 0 0 1 84.641 70` (120° arc, head at top)
- **Gradient:** Head (brand primary, opacity 1) → Tail (same color, opacity 0)
- **Head dot:** `cx=50 cy=10 r=5`, solid brand primary
- **Animation:** `rotate: 360`, `duration: 0.8s`, `ease: linear`, `repeat: Infinity`
- **Reduced motion:** static state (no animation) when `prefers-reduced-motion: reduce`

### Splash Screen

- **Background:** `#0F0D1A` (Splash Background). Not a card or sheet — full-viewport fixed overlay.
- **Ambient glow:** `radial-gradient(ellipse 55% 45% at 50% 50%, rgba(79,70,229,0.22) 0%, transparent 100%)`.
- **Animation sequence:** Container: `opacity:1` on mount (no fade-in prevents FOUC). Logo group: `scale(0.96, opacity:0)` → `scale(1, opacity:1)`, 0.5s `[0.16,1,0.3,1]` ease-out-expo. Arc: `pathLength` 0→1, 0.7s ease-in-out. Dot: `scale(0.4, opacity:0)` → `scale(1, opacity:1)`, 0.25s ease-out, 0.55s delay. Wordmark: `opacity:0` → `opacity:1`, 0.3s, 0.5s delay. Exit: `opacity:0`, 0.35s ease-in-out.
- **Duration:** 1600ms total display (400ms when `prefers-reduced-motion`). Timer-only — no `onAnimationComplete` chaining.
- **Gate:** `sessionStorage('ocar_splash_shown')` — once per browser session. Uses `useLayoutEffect` (fires before browser paint) to prevent FOUC.
- **Placement (driver app):** The `SplashScreen` component must be a sibling rendered **before** the `translateZ(0)` container div. `position:fixed` is clipped to 430px if placed inside that container.

## 6. Do's and Don'ts

### Do's

**Color**
- Use `rgba(79,70,229,X)` for all shadows — carry the brand color into the shadow layer
- Reserve orange (`#F97316`) for the driver app and admin operational states only
- Use Surface 2 (`#F5F7FF`) as the input background — it provides subtle depth without a visible border at rest
- Use Indigo Subtle (`#EEF2FF`) for selected/active states that shouldn't carry the full primary weight

**Typography**
- Use Inter for all new text — no new font imports from any app
- Set `letter-spacing: -0.03em` on Display; `letter-spacing: -0.02em` on Headline — tight tracking is what makes Inter feel premium at display sizes
- Use `font-weight: 700` for brand wordmark; `font-weight: 600` for UI headlines

**Buttons**
- Use pill shape (`border-radius: 9999px`) for user-app primary CTAs
- Use rounded-2xl (`border-radius: 24px`) for driver-app primary CTAs
- Include the Button Primary shadow (`0 4px 20px rgba(79,70,229,0.40)`) on every indigo primary button — it is the affordance signal

**Layout**
- Keep the primary action on any screen unmissable — if the user has to look for the button, the layout is wrong
- Use Bottom Sheet shadow for all sheet components: `0 -6px 32px rgba(79,70,229,0.10)`
- Constrain user and driver apps to the 430px max-width centered layout; admin is full-width on desktop

**Accessibility**
- Provide `prefers-reduced-motion` alternates for every Framer Motion animation — timer-based splash fallback, no-animation spinner
- Keep all touch targets ≥ 44×44px
- Never use color as the sole state indicator — always pair with icon, label, or shape change

### Don'ts

**Absolute bans (match-and-refuse)**
- **No gradient text.** `background-clip: text` + gradient is forbidden everywhere in the system. Use solid Ink 900, white, or a single solid brand color.
- **No side-stripe borders.** `border-left` or `border-right` > 1px as a colored accent on cards, callouts, or list items. Rewrite with background tint or full border. _(A violation exists at `apps/driver/src/components/map/SelfCarMarker.tsx:81` — `borderLeft: '5px solid'` — to be resolved.)_
- **No glassmorphism on main surfaces.** Blur/glass effects are not part of this system; they fight the clean shadow vocabulary.
- **No hero-metric template.** Big numbers in gradient rings with "stats below" is the SaaS cliché this system explicitly rejects (PRODUCT.md anti-reference).

**Color**
- Do not use orange (`#F97316`) in the user booking flow — not on buttons, chips, status indicators, or highlights. It belongs to the operational layer.
- Do not use neutral gray shadows (`rgba(0,0,0,X)`) — always use the indigo-tinted variant.
- Do not use full-saturation primary on inactive states — use Indigo Subtle or Surface 2 instead.
- Do not flood the screen with indigo — if more than 25% of the surface carries the primary color, redesign the hierarchy.

**Typography**
- Do not import Poppins or DM Sans for new work — they are legacy divergences being phased out.
- Do not use tracked all-caps eyebrow labels (e.g., `TEXT-TRANSFORM: UPPERCASE; LETTER-SPACING: 0.1em`) — Ocar's voice is direct, not magazine-formatted.
- Do not use font sizes below 12px for anything the user needs to read or act on.

**Buttons**
- Do not mix pill and rounded-rectangular buttons on the same screen.
- Do not use gradient text on button labels — the gradient is on the button background, the label is white.
- Do not use the Go-Online orange CTA in any user-facing screen.

**Layout**
- Do not nest cards inside cards.
- Do not use `border-left` > 1px as a design element (see Absolute bans).
- Do not add decorative motion that does not convey state — transitions are for feedback, not theatre.
