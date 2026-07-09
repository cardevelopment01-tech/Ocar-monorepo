import { useState, useEffect, useRef } from 'react'

// Matches the 3s driver sync interval, car glides continuously with no pause between fixes
const DURATION = 3_000

function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180
  return (from + delta * t + 360) % 360
}

// Compass bearing (0–360°) from point A to point B
function bearingDeg(from: [number, number], to: [number, number]): number {
  const lat1 = from[0] * Math.PI / 180
  const lat2 = to[0]   * Math.PI / 180
  const dLng = (to[1] - from[1]) * Math.PI / 180
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

// Equirectangular distance in metres, fast, accurate enough at sub-km scales
function distMetres(a: [number, number], b: [number, number]): number {
  const R = 6_371_000
  const dLat = (b[0] - a[0]) * Math.PI / 180
  const dLng = (b[1] - a[1]) * Math.PI / 180
  const avgLat = ((a[0] + b[0]) / 2) * Math.PI / 180
  return Math.sqrt((dLat * R) ** 2 + (dLng * R * Math.cos(avgLat)) ** 2)
}

/**
 * Smoothly interpolates driver position and heading between raw socket fixes.
 *
 * Position uses linear interpolation over the full sync interval so the car
 * moves at constant speed with no pause, same as Uber/Ola.
 *
 * Heading is derived from the bearing between consecutive GPS fixes rather
 * than from raw coords.heading, which is unreliable on many devices. The car
 * only rotates when the driver has actually moved (>8 m threshold), preventing
 * spin at low speed or when stationary.
 */
export function useInterpolatedPosition(
  rawPos: [number, number] | undefined,
  rawHeading: number,
): { pos: [number, number] | undefined; heading: number } {
  const [pos,     setPos]     = useState<[number, number] | undefined>(rawPos)
  const [heading, setHeading] = useState(rawHeading)

  const rafRef  = useRef<number | null>(null)
  const livePos = useRef<[number, number] | null>(null)
  const liveHdg = useRef(0)
  const anim    = useRef<{
    from: [number, number]; fromHdg: number
    to:   [number, number]; toHdg:   number
    start: number
  } | null>(null)

  useEffect(() => {
    if (!rawPos) return

    // First fix, snap immediately, use rawHeading as initial orientation
    if (!livePos.current) {
      livePos.current = rawPos
      liveHdg.current = rawHeading
      setPos(rawPos)
      setHeading(rawHeading)
      return
    }

    // Derive heading from direction of travel; keep current heading if nearly stationary
    const dist  = distMetres(livePos.current, rawPos)
    const toHdg = dist > 8 ? bearingDeg(livePos.current, rawPos) : liveHdg.current

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    anim.current = {
      from:    livePos.current,
      fromHdg: liveHdg.current,
      to:      rawPos,
      toHdg,
      start:   performance.now(),
    }

    const tick = (now: number) => {
      const a = anim.current!
      const t = Math.min((now - a.start) / DURATION, 1)

      // Linear, constant speed produces continuous Uber-like motion with no deceleration pause
      const lat = a.from[0] + (a.to[0] - a.from[0]) * t
      const lng = a.from[1] + (a.to[1] - a.from[1]) * t
      const hdg = lerpAngle(a.fromHdg, a.toHdg, t)

      livePos.current = [lat, lng]
      liveHdg.current = hdg
      setPos([lat, lng])
      setHeading(hdg)

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  // rawPos is a new array reference on each socket event, intentional dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPos, rawHeading])

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  return { pos, heading }
}
