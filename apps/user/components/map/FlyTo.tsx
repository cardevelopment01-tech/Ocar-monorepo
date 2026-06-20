'use client'

import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

interface FlyToProps {
  target: [number, number] | null
  zoom?: number
}

export default function FlyTo({ target, zoom = 16 }: FlyToProps) {
  const map = useMap()
  useEffect(() => {
    if (!target) return
    map.flyTo(target, zoom, { animate: true, duration: 1.2 })
  }, [target, zoom, map])
  return null
}
