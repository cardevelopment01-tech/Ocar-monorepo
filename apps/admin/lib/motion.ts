// One motion config for Reports (design D13, DESIGN.md: 150-250 ms, state changes only).
// Nothing here entrances, draws in, staggers or loops. Reduced motion: opacity only, 100 ms.

export const MOTION = {
  /** tab pill slide */
  tabMs: 200,
  /** old data dims while new data loads; new data crossfades in */
  dimOpacity: 0.6,
  crossfadeMs: 200,
  /** charts tween from previous values */
  chartMs: 250,
  /** KPI numbers tween only when the value changes */
  numberMs: 250,
  /** reduced motion */
  reducedMs: 100,
  /** exponential ease-out, matches the drawer/toggle easing in DESIGN.md */
  ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
} as const

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
