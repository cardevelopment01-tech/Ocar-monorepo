'use client'

import { useEffect, useRef } from 'react'
import { useMap } from 'react-map-gl/maplibre'

interface FitBoundsProps {
  positions: [number, number][]
  padding?: [number, number]
  paddingBottom?: number
}

export default function FitBounds({ positions, padding = [56, 56], paddingBottom = 40 }: FitBoundsProps) {
  const { current: map } = useMap()
  const key = positions.map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|')
  const lastKey = useRef('')

  useEffect(() => {
    if (!map || positions.length < 2 || key === lastKey.current) return
    lastKey.current = key

    const lats = positions.map(p => p[0])
    const lngs = positions.map(p => p[1])
    const sw: [number, number] = [Math.min(...lngs), Math.min(...lats)]
    const ne: [number, number] = [Math.max(...lngs), Math.max(...lats)]

    map.fitBounds([sw, ne], {
      padding: { top: padding[1], right: padding[0], bottom: padding[1] + paddingBottom, left: padding[0] },
      duration: 700,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return null
}
