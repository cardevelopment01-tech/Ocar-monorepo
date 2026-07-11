import { useEffect } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

// No @types/google.maps ambient declaration in this repo — the Maps JS API script
// (loaded by @vis.gl/react-google-maps) attaches `google` to window at runtime, so
// we read it dynamically rather than referencing the bare `google` global by name.
type GoogleMapsNamespace = { maps: { TrafficLayer: new () => { setMap: (m: unknown) => void } } }

/**
 * Overlays Google's live traffic layer (color-coded road congestion) on the map.
 * This is the free `google.maps.TrafficLayer` tile overlay — same data source as
 * the Google Maps app, no extra billed API calls, just a visual layer on the
 * already-loaded Maps JS API. See docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md §1
 * ("No live traffic" was the one gap flagged after Phase 1 TBT shipped).
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
