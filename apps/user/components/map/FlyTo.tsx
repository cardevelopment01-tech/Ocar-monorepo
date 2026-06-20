'use client'

import { useEffect } from 'react'
import { useMap } from 'react-map-gl/maplibre'

interface FlyToProps {
  target: [number, number] | null
  zoom?: number
}

export default function FlyTo({ target, zoom = 16 }: FlyToProps) {
  const { current: map } = useMap()
  useEffect(() => {
    if (!map || !target) return
    map.flyTo({ center: [target[1], target[0]], zoom, speed: 1.4 })
  }, [target, zoom, map])
  return null
}
