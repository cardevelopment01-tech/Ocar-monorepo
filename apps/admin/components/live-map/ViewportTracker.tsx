'use client'

import { useEffect } from 'react'
import { useMap } from '@vis.gl/react-google-maps'
import type { Bounds } from '@/lib/live-map-cluster'

export interface Viewport { zoom: number; bounds: Bounds }

// Tells the page what part of the map is on screen and how far it is zoomed, once the map has settled after a pan or zoom ('idle'), so
// it can merge drivers into clusters and draw only the ones in view. Must be inside the map.
export function ViewportTracker({ onChange }: { onChange: (v: Viewport) => void }) {
  const map = useMap()
  useEffect(() => {
    if (!map) return
    const read = () => {
      const b = map.getBounds(), zoom = map.getZoom()
      if (!b || zoom == null) return
      const ne = b.getNorthEast(), sw = b.getSouthWest()
      onChange({ zoom, bounds: { north: ne.lat(), south: sw.lat(), east: ne.lng(), west: sw.lng() } })
    }
    read()
    const l = map.addListener('idle', read)
    return () => l.remove()
  }, [map, onChange])
  return null
}
