import { useState, useEffect, useRef } from 'react'

const DURATION = 1500 // ms — matches expected socket interval between driver:location events

function lerpAngle(from: number, to: number, t: number): number {
  const delta = ((to - from + 540) % 360) - 180
  return (from + delta * t + 360) % 360
}

/**
 * Smoothly interpolates driver position and heading between raw socket fixes
 * using a rAF loop + ease-out cubic. Eliminates the "teleporting car" effect.
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

    // First fix — snap immediately without animation
    if (!livePos.current) {
      livePos.current = rawPos
      liveHdg.current = rawHeading
      setPos(rawPos)
      setHeading(rawHeading)
      return
    }

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)

    anim.current = {
      from:    livePos.current,
      fromHdg: liveHdg.current,
      to:      rawPos,
      toHdg:   rawHeading,
      start:   performance.now(),
    }

    const tick = (now: number) => {
      const a  = anim.current!
      const t  = Math.min((now - a.start) / DURATION, 1)
      const et = 1 - (1 - t) ** 3  // ease-out cubic

      const lat = a.from[0] + (a.to[0] - a.from[0]) * et
      const lng = a.from[1] + (a.to[1] - a.from[1]) * et
      const hdg = lerpAngle(a.fromHdg, a.toHdg, et)

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
  // rawPos is a new array ref each socket event — correct trigger
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawPos, rawHeading])

  // Cleanup on unmount
  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }, [])

  return { pos, heading }
}
