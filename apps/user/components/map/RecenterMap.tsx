'use client'

import { useEffect, useRef, useState } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

interface RecenterMapProps {
  center: [number, number]
  animate?: boolean
  /** Rotates the map to match the driver's heading — only meaningful once headingKnown. */
  heading?: number
  /** False until a real bearing has been derived (see useInterpolatedPosition) — camera
   *  stays north-up until then, same as the marker's own neutral-state behaviour. */
  headingKnown?: boolean
}

// Shortest signed delta (degrees) from `from` to `to`, e.g. 350 -> 10 gives +20, not -340.
function shortestAngleDelta(from: number, to: number): number {
  let delta = (to - from) % 360
  if (delta > 180) delta -= 360
  if (delta < -180) delta += 360
  return delta
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
const HEADING_ANIM_MS = 350

export default function RecenterMap({ center, animate = true, heading, headingKnown = true }: RecenterMapProps) {
  const map = useMap()
  const last       = useRef<[number, number] | null>(null)
  const lastHdg    = useRef<number>(-1)
  const appliedHdg = useRef<number | null>(null)
  const headingRaf = useRef<number | null>(null)
  // Bumped by the tilesloaded listener to force a re-centre after the map has fully
  // loaded, matching the driver app's RecenterMap (guards against a slow initial tile load).
  const [retryCount, setRetryCount] = useState(0)

  // Same smoothed-rotation approach as the driver app's RecenterMap, applied from the
  // start here rather than the hard setHeading() that originally caused the driver-side
  // double-rotation bug — see docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md §1.1.
  function animateHeadingTo(target: number) {
    if (!map) return
    if (headingRaf.current !== null) cancelAnimationFrame(headingRaf.current)

    if (appliedHdg.current === null) {
      map.setHeading(target)
      appliedHdg.current = target
      return
    }

    const start = appliedHdg.current
    const delta = shortestAngleDelta(start, target)
    const startTime = performance.now()

    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / HEADING_ANIM_MS)
      const eased = easeOutCubic(t)
      const value = (start + delta * eased + 360) % 360
      map.setHeading(value)
      appliedHdg.current = value
      if (t < 1) {
        headingRaf.current = requestAnimationFrame(step)
      } else {
        headingRaf.current = null
      }
    }
    headingRaf.current = requestAnimationFrame(step)
  }

  useEffect(() => () => {
    if (headingRaf.current !== null) cancelAnimationFrame(headingRaf.current)
  }, [])

  useEffect(() => {
    if (!map) return
    const listener = map.addListener('tilesloaded', () => {
      listener.remove()
      last.current = null
      setRetryCount(c => c + 1)
    })
    return () => listener.remove()
  }, [map])

  useEffect(() => {
    if (!map) return
    const [lat, lng] = center
    const prev  = last.current
    const moved = !prev || Math.abs(prev[0] - lat) >= 2e-5 || Math.abs(prev[1] - lng) >= 2e-5
    const hdgChgd = headingKnown && typeof heading === 'number' && Math.abs(lastHdg.current - heading) >= 2

    if (!moved && !hdgChgd) return

    if (hdgChgd && typeof heading === 'number') {
      animateHeadingTo(heading)
      lastHdg.current = heading
    }

    if (!moved) return

    last.current = [lat, lng]
    if (animate) {
      map.panTo({ lat, lng })
    } else {
      map.moveCamera({ center: { lat, lng } })
    }
  // retryCount intentional: re-runs after tilesloaded fires, matching the driver app's pattern.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, map, animate, heading, headingKnown, retryCount])

  return null
}
