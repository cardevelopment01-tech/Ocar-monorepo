---
target: apps/driver/src
total_score: 24
p0_count: 0
p1_count: 3
p2_count: 2
timestamp: 2026-06-22T09-52-03Z
slug: apps-driver-src
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good loading states; online pill is clear; mock earnings show no disclaimer |
| 2 | Match System / Real World | 3 | Language is plain; "Category 1" on StandardConfirm is opaque |
| 3 | User Control and Freedom | 3 | Back buttons and confirmation dialogs exist; onboarding save state is implicit |
| 4 | Consistency and Standards | 1 | The defining failure: blue CTAs vs indigo brand, 3 accent colors on Home, neutral vs indigo shadows, back-button styles differ, min-h-screen vs h-[100dvh] |
| 5 | Error Prevention | 3 | Double-submit guards, destructive action confirmations, inline validation |
| 6 | Recognition Rather Than Recall | 3 | Nav has labels, modes are described, progress bar on onboarding |
| 7 | Flexibility and Efficiency | 2 | OTP auto-submit is good; no shortcuts; no way to revisit completed onboarding steps |
| 8 | Aesthetic and Minimalist Design | 2 | Home crams map+stats+actions+banner; Earnings has two "Breakdown" sections; ModeSelection has decorative 01/02 noise |
| 9 | Error Recovery | 3 | OTP errors are specific; generic "Something went wrong" on a few API paths |
| 10 | Help and Documentation | 1 | No in-app help; Help & Support in Profile is a dead button; onboarding has no document-prep guidance |
| **Total** | | **24/40** | **Acceptable — significant improvements needed** |

## Anti-Patterns Verdict

**LLM assessment:** The app reads as built across multiple sessions that never reconciled the component vocabulary. The button and logo color on Login, PersonalDetails, and StandardConfirm is Tailwind blue (#3B82F6/#2563EB), not brand indigo (#4F46E5). The brand's signature indigo does not appear on any primary CTA. The Home stat grid uses three competing semantic colors (green/blue/amber) at identical visual weight — the hero-metric template explicitly called out in the anti-references. Eyebrow labels (uppercase tiny tracking-widest) appear on nearly every screen.

**Deterministic scan:** 2 real warnings: SelfCarMarker.tsx:81-82 side-stripe borders (borderLeft/Right 5px solid). ~50 advisories documenting color drift across 12+ files. 1 false positive: Inter overused-font (intentional per DESIGN.md).

## Overall Impression

The app is built and works. The bones are solid. But it has the feel of a product assembled from multiple sessions that never had its component vocabulary enforced. Fix the button color (blue → indigo) and half the other problems resolve automatically.

## What's Working

1. Loading and feedback states are genuinely good (OcarSpinner, skeleton loaders, OTP countdown, double-submit guards).
2. BottomNav is the cleanest component — active indicator, icon+text always paired, indigo used correctly.
3. Onboarding form UX is well-thought-out (DOB bounds, auto-city, experience stepper, inline validation).

## Priority Issues

### [P1] Wrong primary button color across entire app
- **What:** btn-primary/btn-go use #3B82F6→#2563EB (Tailwind blue). Brand is #4F46E5→#7C3AED (indigo-violet). Brand color never appears on any primary CTA.
- **Fix:** Update index.css gradient and focus ring to use rgba(79,70,229,X). Update Login logo box to use OcarLogoMark or indigo gradient.
- **Command:** /impeccable colorize apps/driver/src

### [P1] Home stat grid: three competing accent colors
- **What:** Home.tsx:217-242 uses green (#16A34A), blue (#2563EB), amber (#D97706) for Earned/Trips/Rating at identical visual weight.
- **Fix:** Earned gets indigo treatment. Trips/Rating get neutral surface — no colored tint. Color difference signals hierarchy.
- **Command:** /impeccable layout apps/driver/src/pages/Home.tsx

### [P1] Eyebrow labels on nearly every screen
- **What:** text-[10px] font-bold uppercase tracking-widest used as field labels, section kickers, card titles throughout (Login, Home, ModeSelection, Earnings, all onboarding cards).
- **Fix:** Replace with Label weight (13px, 500, normal case). Section kickers: omit or use first content as label.
- **Command:** /impeccable typeset apps/driver/src

### [P2] Side-stripe on Earnings card + numbered markers on ModeSelection
- **What:** Earnings.tsx:69 borderLeftColor/#2563EB borderLeftWidth/3. ModeSelection.tsx:56,100 decorative 01/02 float numbers.
- **Fix:** Remove borderLeft from Earnings card. Remove 01/02 spans from ModeSelection.
- **Command:** /impeccable polish apps/driver/src

### [P2] Neutral shadows throughout — indigo shadow system absent
- **What:** All shadows use rgba(0,0,0,X). DESIGN.md Indigo Shadow Rule requires rgba(79,70,229,X).
- **Fix:** Update driver-card, GLASS, bottom-sheet, BottomNav shadows to indigo-tinted equivalents.
- **Command:** /impeccable polish apps/driver/src

## Persona Red Flags

**Casey (distracted mobile user):** Home stat grid has no hierarchy — three equal-weight colored chips fight under sunlight. Online status pill is 11px — too small for glance reading.

**Jordan (new driver onboarding):** All form labels are uppercase tiny tracking-widest — bureaucratic feel. "Category 1" on StandardConfirm is opaque. No pre-screen guidance on what documents to prepare.

**Raju (working driver):** Button blue vs brand indigo creates subtle brand confusion. Mock earnings on Home have no disclaimer — trust risk. Stats equal weight makes earnings harder to find at a glance.

## Minor Observations

- Poppins still imported in index.css — unused, adds ~30KB font load
- Home greeting uses 👋 emoji — inconsistent with "plain and direct" brand voice
- Back button styles differ across pages (bg-surface-2 vs bg-white border)
- Earnings has two "Breakdown" section headings
- SelfCarMarker.tsx:81-82 side-stripe borders on map marker component
- ModeSelection uses min-h-screen while other pages use h-[100dvh]
