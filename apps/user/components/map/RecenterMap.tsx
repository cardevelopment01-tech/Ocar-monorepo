'use client'

import { useEffect, useRef } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

interface RecenterMapProps {
  center: [number, number]
  animate?: boolean
}

export default function RecenterMap({ center, animate = true }: RecenterMapProps) {
  const map = useMap()
  const last = useRef<[number, number] | null>(null)

  useEffect(() => {
    if (!map) return
    const [lat, lng] = center
    const prev = last.current
    if (prev && Math.abs(prev[0] - lat) < 2e-5 && Math.abs(prev[1] - lng) < 2e-5) return
    last.current = [lat, lng]
    if (animate) {
      map.panTo({ lat, lng })
    } else {
      map.moveCamera({ center: { lat, lng } })
    }
  }, [center, map, animate])

  return null
}
