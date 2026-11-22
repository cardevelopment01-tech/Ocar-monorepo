'use client'

import { useRef, useState } from 'react'
import { Map as GoogleMap, useMap } from '@vis.gl/react-google-maps'
import { RotateCcw } from 'lucide-react'
import { BoundaryMapLayer } from '@/components/BoundaryEditor'
import MapPlaceSearch from '@/components/MapPlaceSearch'
import type { CityBoundaryGeoJson } from '@/lib/boundary-api'
import { parsePastedPolygon, polygonAreaKm2 } from '@/lib/boundary-utils'

const MAP_ID = 'polygon-picker-map'
// The server refuses a zone larger than this (see the API's airport zone rules); shown here so the admin sees it while drawing.
export const MAX_ZONE_KM2 = 100

/** Draw a single outline on a map: click points around the area, click the first point to finish, drag points to adjust.
 * Replaces pasting GeoJSON; the paste box stays behind a small link for anyone who already has a shape. */
export default function PolygonPicker({ initial, center, onChange }: {
  initial: CityBoundaryGeoJson | null
  center: { lat: number; lng: number }
  onChange: (polygon: CityBoundaryGeoJson | null) => void
}) {
  const [value, setValue] = useState<CityBoundaryGeoJson | null>(initial)
  const [mapKey, setMapKey] = useState(0)
  const [start, setStart] = useState<CityBoundaryGeoJson | null>(initial)
  const [mapError, setMapError] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteError, setPasteError] = useState('')
  const loadFeatureRef = useRef<((geojson: CityBoundaryGeoJson) => string | null) | null>(null)
  const map = useMap(MAP_ID)

  const handleChange = (p: CityBoundaryGeoJson | null) => { setValue(p); onChange(p) }
  const area = polygonAreaKm2(value)
  const tooBig = area > MAX_ZONE_KM2

  const startOver = () => { setStart(null); setMapKey(k => k + 1); handleChange(null) }

  const loadPasted = () => {
    const r = parsePastedPolygon(pasteText)
    if (!r.ok) { setPasteError(r.error.replace('City boundaries are', 'A zone is')); return }
    const err = loadFeatureRef.current?.(r.polygon) ?? null
    if (err) { setPasteError(err); return }
    // A pasted shape can be anywhere: bring the map to it, otherwise it looks like nothing happened.
    if (map && typeof google !== 'undefined') {
      const bounds = new google.maps.LatLngBounds()
      for (const [lng, lat] of r.polygon.coordinates[0]!) bounds.extend({ lat, lng })
      map.fitBounds(bounds, 40)
    }
    setPasteError(''); setPasteOpen(false); setPasteText('')
  }

  return (
    <div className="space-y-2">
      <div className="relative h-[340px] rounded-xl overflow-hidden border border-border">
        <GoogleMap id={MAP_ID} defaultCenter={center} defaultZoom={14} mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
          gestureHandling="greedy" disableDefaultUI style={{ width: '100%', height: '100%' }}>
          <BoundaryMapLayer key={mapKey} cityId={0} initialBoundary={start} overlays={[]} onChange={handleChange} onError={setMapError} loadFeatureRef={loadFeatureRef} />
        </GoogleMap>
        <MapPlaceSearch mapId={MAP_ID} placeholder="Search the airport on the map" />
      </div>

      <div className="flex items-center justify-between gap-3 text-xs" role="status" aria-live="polite">
        {value
          ? <span className={tooBig ? 'text-danger font-semibold' : 'text-text-secondary'}>
              Area <span className="font-mono">{area < 0.01 ? '<0.01' : area.toFixed(2)} km²</span>
              {tooBig ? ` is over the ${MAX_ZONE_KM2} km² limit. Draw just the airport, not the city around it.` : ''}
            </span>
          : <span className="text-text-muted">Click points around the airport, then click the first point to finish. Drag a point to adjust it.</span>}
        <button type="button" onClick={startOver} disabled={!value}
          className="inline-flex items-center gap-1 font-semibold text-primary hover:underline disabled:opacity-40 disabled:no-underline flex-shrink-0">
          <RotateCcw size={12} />Start over
        </button>
      </div>

      {mapError && <p role="alert" className="text-xs text-danger font-semibold">{mapError}</p>}

      {!pasteOpen ? (
        <button type="button" onClick={() => setPasteOpen(true)} className="text-xs font-semibold text-primary hover:underline">Paste GeoJSON instead</button>
      ) : (
        <div className="space-y-1.5">
          <textarea aria-label="GeoJSON polygon" value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4}
            placeholder='{ "type": "Polygon", "coordinates": [...] }'
            className="w-full border border-border rounded-xl px-3 py-2 text-xs font-mono text-text-primary bg-surface-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted" />
          {pasteError && <p role="alert" className="text-xs text-danger">{pasteError}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={loadPasted} disabled={!pasteText.trim()} className="btn-secondary !text-xs !py-1.5 disabled:opacity-50">Load</button>
            <button type="button" onClick={() => { setPasteOpen(false); setPasteText(''); setPasteError('') }} className="text-xs text-text-muted hover:text-text-secondary">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
