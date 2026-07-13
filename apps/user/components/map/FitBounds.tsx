'use client'

import { useEffect, useRef } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'

interface FitBoundsProps {
  positions: [number, number][]
  padding?: [number, number]
  paddingBottom?: number
}

// Caps how tight fitBounds is allowed to zoom when the two fitted points are
// very close together (e.g. "driver has arrived" — driver+pickup ~10-50m
// apart), which otherwise pushes zoom to 19-20+ and makes buildings loom
// over a comically tiny car icon. z17 ≈ 300m viewport width — close enough
// to read "driver is right there" without amplifying GPS jitter (~5-15m
// urban) into a visibly wandering marker. See docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 7a.
const MAX_FIT_ZOOM = 17

export default function FitBounds({ positions, padding = [56, 56], paddingBottom = 40 }: FitBoundsProps) {
  const map = useMap()
  const mapsCore = useMapsLibrary('core')
  const key = positions.map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|')
  const lastKey = useRef('')

  useEffect(() => {
    if (!map || !mapsCore || positions.length < 2 || key === lastKey.current) return
    lastKey.current = key

    const bounds = new mapsCore.LatLngBounds()
    positions.forEach(([lat, lng]) => bounds.extend({ lat, lng }))

    // fitBounds natively respects maxZoom — capping it here prevents the
    // overshoot outright, instead of letting it happen and correcting after
    // (which would cause a visible zoom-in-then-snap-back flash).
    map.setOptions({ maxZoom: MAX_FIT_ZOOM })
    map.fitBounds(bounds, {
      top: padding[1],
      right: padding[0],
      bottom: padding[1] + paddingBottom,
      left: padding[0],
    })
    const listener = map.addListener('idle', () => {
      listener.remove()
      map.setOptions({ maxZoom: null })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map, mapsCore])

  return null
}
