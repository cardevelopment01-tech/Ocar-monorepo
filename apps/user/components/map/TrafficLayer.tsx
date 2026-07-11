'use client'

import { useEffect } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

// No @types/google.maps ambient declaration in this repo — read window.google
// dynamically rather than referencing the bare `google` global by name.
type GoogleMapsNamespace = { maps: { TrafficLayer: new () => { setMap: (m: unknown) => void } } }

/**
 * Overlays Google's live traffic layer (color-coded road congestion) on the map.
 * Mirrors apps/driver/src/components/map/TrafficLayer.tsx — see
 * docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md §1 for why this was missing.
 */
export default function TrafficLayer() {
  const map = useMap()

  useEffect(() => {
    if (!map) return
    const g = (window as unknown as { google?: GoogleMapsNamespace }).google
    if (!g?.maps?.TrafficLayer) return
    const layer = new g.maps.TrafficLayer()
    layer.setMap(map)
    return () => layer.setMap(null)
  }, [map])

  return null
}
