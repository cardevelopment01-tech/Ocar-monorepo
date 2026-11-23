'use client'
import { useEffect } from 'react'
import { Map as GoogleMap, AdvancedMarker, Pin, useMap } from '@vis.gl/react-google-maps'

export interface RideMapPoint { lat: number; lng: number }

// Fits the view to everything drawn and draws the driver's route as a line.
function Layer({ pickup, drop, trail }: { pickup: RideMapPoint | null; drop: RideMapPoint | null; trail: RideMapPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (!map || typeof google === 'undefined') return
    const all = [pickup, drop, ...trail].filter((p): p is RideMapPoint => p !== null)
    if (all.length === 0) return
    const bounds = new google.maps.LatLngBounds()
    all.forEach(p => bounds.extend(p))
    map.fitBounds(bounds, 48)
    if (all.length === 1) map.setZoom(15)
    if (trail.length < 2) return
    const line = new google.maps.Polyline({ path: trail, strokeColor: '#0E8FA3', strokeOpacity: 0.9, strokeWeight: 4, clickable: false })
    line.setMap(map)
    return () => line.setMap(null)
  }, [map, pickup, drop, trail])
  return null
}

/** Pickup (green), drop (red) and, once a driver has been on the trip, their recorded route. */
export default function RideMap({ pickup, drop, trail, trailState }: {
  pickup: RideMapPoint | null; drop: RideMapPoint | null; trail: RideMapPoint[]
  trailState: 'loading' | 'ready' | 'failed' | 'none'
}) {
  const center = pickup ?? drop ?? { lat: 20.27, lng: 85.84 }
  return (
    <div className="space-y-1.5">
      <div className="relative h-64 rounded-xl overflow-hidden border border-border-light">
        <GoogleMap defaultCenter={center} defaultZoom={12} mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
          gestureHandling="cooperative" disableDefaultUI zoomControl style={{ width: '100%', height: '100%' }}>
          {pickup && <AdvancedMarker position={pickup} title="Pickup"><Pin background="#16A34A" borderColor="#FFFFFF" glyphColor="#FFFFFF" /></AdvancedMarker>}
          {drop && <AdvancedMarker position={drop} title="Drop"><Pin background="#DC2626" borderColor="#FFFFFF" glyphColor="#FFFFFF" /></AdvancedMarker>}
          <Layer pickup={pickup} drop={drop} trail={trail} />
        </GoogleMap>
      </div>
      <p className="text-[11px] text-text-muted">
        <span className="text-success font-semibold">Pickup</span>{drop ? <> · <span className="text-danger font-semibold">Drop</span></> : null}
        {trailState === 'loading' && ' · loading the driver\'s route…'}
        {trailState === 'ready' && ` · driver route (${trail.length} points)`}
        {trailState === 'none' && ' · no driver route recorded'}
        {trailState === 'failed' && ' · could not load the driver\'s route'}
      </p>
    </div>
  )
}
