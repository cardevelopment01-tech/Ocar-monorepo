'use client'

import { useEffect, useRef } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'

interface FitBoundsProps {
  positions: [number, number][]
  padding?: [number, number]
  paddingBottom?: number
}

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

    map.fitBounds(bounds, {
      top: padding[1],
      right: padding[0],
      bottom: padding[1] + paddingBottom,
      left: padding[0],
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map, mapsCore])

  return null
}
