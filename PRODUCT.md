# Product

## Register

product

## Users

Three distinct user groups across three apps:

**Passengers (user app)** — everyday riders in Bhubaneswar, Cuttack, and Puri. Booking intercity cabs for practical journeys: work, family, errands. Mobile-first, varied digital literacy, often in transit or in a hurry. Primary task: book a ride fast and know it's coming.

**Drivers (driver app)** — local drivers managing their working day. Onboarding, going online, accepting rides, tracking earnings. Mobile-only. Often in low-light or outdoor conditions. Primary task: get online and accept rides without friction.

**Ops team (admin app)** — small internal team managing drivers, pricing, disputes, and real-time operations. Likely on desktop. Primary task: maintain quality and resolve issues quickly.

## Product Purpose

Ocar is an intercity cab booking platform built specifically for Odisha, India — connecting passengers across Bhubaneswar, Cuttack, and Puri. It exists because the region deserves a reliable, modern ride-hailing experience that feels made for it, not imported. Success looks like rides completed on time, drivers earning consistently, and ops running smoothly without manual overhead.

## Brand Personality

Reliable · Efficient · Local

Voice is plain and direct — no marketing fluff, no over-designed moments. The interface earns trust through consistency, not decoration. It feels like something built by people who know Odisha, not a global template dropped in.

## Anti-references

- **Generic SaaS / Tailwind startup template** — avoid the indigo-gradient hero, white card grid, eyebrow labels on every section, and gradient text that reads as "built with AI in an afternoon." This is the single most important anti-pattern given the existing brand colors (indigo-violet), which already pull toward this trap. Every design decision must actively resist it.
- **OLA / legacy Indian cab app aesthetic** — avoid cluttered layouts, low-contrast text, aggressive promotional banners, and feature-heavy screens that bury the primary action.

## Design Principles

1. **Clarity is the feature.** The primary action on any screen should be unmissable. Secondary information earns its place or gets cut. No visual decoration that doesn't reduce cognitive load.

2. **Speed is felt, not just measured.** Transitions, loading states, and state changes should feel instant and intentional — not theatrical. A 200ms purposeful transition beats a 1.8s cinematic entrance.

3. **Built for Odisha, not adapted for it.** Design decisions should reflect actual users: mobile screens in bright sunlight, varied data speeds, practical journeys. Not aspirational global-app aesthetics.

4. **Trust through consistency.** The same component behaves the same way everywhere. Pattern predictability is the product's reliability promise made visual.

5. **Mobile is the whole job.** User and driver apps are mobile-only. Admin is desktop-primary but must work at 768px. Desktop scale is not the default canvas.

## Accessibility & Inclusion

- WCAG 2.1 AA minimum across all three apps
- Touch targets ≥ 44×44px on all interactive elements
- Color is never the sole indicator of state (errors, status, active)
- All animations respect `prefers-reduced-motion`
- Body text minimum 16px; no muted gray that fails 4.5:1 contrast
