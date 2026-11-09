import { haversineMetres } from '../geo'

// How the car marker travels from one reported position to the next: a smooth glide over the polling interval, or a snap
// when gliding would lie (a big jump, a hidden tab that just came back, a first position, or a viewer who asked for less motion).

export const SNAP_ABOVE_METRES = 300
export const MIN_GLIDE_MS = 800
export const MAX_GLIDE_MS = 8_000

export type GlidePlan = { snap: true } | { snap: false; durationMs: number }

export function planGlide(input: {
  from: [number, number] | null
  to: [number, number]
  /** Time since the previous position arrived. */
  sinceLastMs: number
  hidden: boolean
  reducedMotion: boolean
}): GlidePlan {
  if (!input.from || input.hidden || input.reducedMotion) return { snap: true }
  if (haversineMetres(input.from, input.to) > SNAP_ABOVE_METRES) return { snap: true }
  return { snap: false, durationMs: Math.min(MAX_GLIDE_MS, Math.max(MIN_GLIDE_MS, input.sinceLastMs)) }
}

/** Linear position between two points at progress 0..1 (the distances involved are far too short for the curve of the earth to matter). */
export function lerpPosition(a: [number, number], b: [number, number], t: number): [number, number] {
  const k = Math.min(1, Math.max(0, t))
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
}
