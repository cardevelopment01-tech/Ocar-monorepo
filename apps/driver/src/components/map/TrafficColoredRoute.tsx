import { useMemo } from 'react'
import { Polyline } from '@vis.gl/react-google-maps'
import { decodePolyline } from '@/lib/polyline'
import type { TrafficInterval } from '@/lib/ride-api'

const SPEED_COLOR: Record<'SLOW' | 'TRAFFIC_JAM', string> = {
  SLOW: '#F59E0B',
  TRAFFIC_JAM: '#EF4444',
}

interface TrafficColoredRouteProps {
  encoded?: string
  intervals?: TrafficInterval[]
}

/**
 * Overlays congestion-colored segments on top of the base route line — NORMAL
 * segments are left untinted (base route shows through), only SLOW/TRAFFIC_JAM
 * get colored, matching how Google Maps itself only calls out non-free-flowing
 * stretches. `encoded`/`intervals` come from a separate Routes API fetch (see
 * google.provider.ts's getTrafficIntervals) — do not mix indices with the
 * Directions-API-derived route polyline used for turn-by-turn steps.
 */
export default function TrafficColoredRoute({ encoded, intervals }: TrafficColoredRouteProps) {
  const points = useMemo<[number, number][]>(
    () => (encoded ? decodePolyline(encoded) : []),
    [encoded]
  )

  const segments = useMemo(() => {
    if (!points.length || !intervals?.length) return []
    return intervals
      .filter(i => i.speed === 'SLOW' || i.speed === 'TRAFFIC_JAM')
      .map(i => ({
        color: SPEED_COLOR[i.speed as 'SLOW' | 'TRAFFIC_JAM'],
        path: points
          .slice(Math.max(0, i.startIndex), Math.min(points.length, i.endIndex + 1))
          .map(([lat, lng]) => ({ lat, lng })),
      }))
      .filter(s => s.path.length >= 2)
  }, [points, intervals])

  if (!segments.length) return null

  return (
    <>
      {segments.map((s, idx) => (
        <Polyline
          key={idx}
          path={s.path}
          strokeColor={s.color}
          strokeWeight={5}
          strokeOpacity={0.85}
          zIndex={3}
        />
      ))}
    </>
  )
}
