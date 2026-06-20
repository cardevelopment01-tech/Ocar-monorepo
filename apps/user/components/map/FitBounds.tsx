'use client'

import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

interface FitBoundsProps {
  positions: [number, number][]
  /** Extra padding [x, y] in px on each side. Default 56px. */
  padding?: [number, number]
  /** Extra bottom padding for overlapping UI (sheet, pills). Default 40. */
  paddingBottom?: number
}

export default function FitBounds({ positions, padding = [56, 56], paddingBottom = 40 }: FitBoundsProps) {
  const map = useMap()
  // Only re-fit when the set of positions actually changes (not every render)
  const key = positions.map(p => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|')
  const lastKey = useRef('')

  useEffect(() => {
    if (positions.length < 2 || key === lastKey.current) return
    lastKey.current = key
    const bounds = L.latLngBounds(positions.map(p => L.latLng(p[0], p[1])))
    map.fitBounds(bounds, {
      paddingTopLeft:    L.point(padding[0], padding[1]),
      paddingBottomRight: L.point(padding[0], padding[1] + paddingBottom),
      animate: true,
      duration: 0.7,
    })
  })

  return null
}
