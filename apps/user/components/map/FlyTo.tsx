'use client'

import { useEffect } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

interface FlyToProps {
  target: [number, number] | null
  zoom?: number
}

export default function FlyTo({ target, zoom = 16 }: FlyToProps) {
  const map = useMap()

  useEffect(() => {
    if (!map || !target) return
    map.panTo({ lat: target[0], lng: target[1] })
    map.setZoom(zoom)
  }, [target, zoom, map])

  return null
}
