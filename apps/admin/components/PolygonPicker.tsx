'use client'

import { useEffect, useRef, useState } from 'react'
import { Map as GoogleMap, useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { RotateCcw, Search } from 'lucide-react'
import { BoundaryMapLayer } from '@/components/BoundaryEditor'
import type { CityBoundaryGeoJson } from '@/lib/boundary-api'
import { parsePastedPolygon, polygonAreaKm2 } from '@/lib/boundary-utils'

const MAP_ID = 'polygon-picker-map'
// The server refuses a zone larger than this (see the API's airport zone rules); shown here so the admin sees it while drawing.
export const MAX_ZONE_KM2 = 100

// Jump the map to a searched place (e.g. "Biju Patnaik International Airport") so the admin does not have to pan there by hand.
function PlaceSearch() {
  const map = useMap(MAP_ID)
  const places = useMapsLibrary('places')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!map || !places || !inputRef.current) return
    const ac = new places.Autocomplete(inputRef.current, { fields: ['geometry'], componentRestrictions: { country: 'in' } })
    const listener = ac.addListener('place_changed', () => {
      const g = ac.getPlace().geometry
      if (!g) return
      if (g.viewport) map.fitBounds(g.viewport)
      else if (g.location) { map.setCenter(g.location); map.setZoom(16) }
    })
    return () => listener.remove()
  }, [map, places])

  return (
    <div className="absolute top-3 left-3 right-3 sm:right-auto sm:w-72 z-10">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
        <input ref={inputRef} type="text" aria-label="Search for a place on the map" placeholder="Search the airport on the map"
          // Enter must pick a suggestion, not submit the zone form behind the map.
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
          className="w-full border border-border rounded-xl pl-9 pr-3 py-2 text-sm text-text-primary bg-surface shadow-card focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted" />
      </div>
    </div>
  )
}

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

  const handleChange = (p: CityBoundaryGeoJson | null) => { setValue(p); onChange(p) }
  const area = polygonAreaKm2(value)
  const tooBig = area > MAX_ZONE_KM2

  const startOver = () => { setStart(null); setMapKey(k => k + 1); handleChange(null) }

  const loadPasted = () => {
    const r = parsePastedPolygon(pasteText)
    if (!r.ok) { setPasteError(r.error.replace('City boundaries are', 'A zone is')); return }
    const err = loadFeatureRef.current?.(r.polygon) ?? null
    if (err) { setPasteError(err); return }
    setPasteError(''); setPasteOpen(false); setPasteText('')
  }

  return (
    <div className="space-y-2">
      <div className="relative h-[340px] rounded-xl overflow-hidden border border-border">
        <GoogleMap id={MAP_ID} defaultCenter={center} defaultZoom={14} mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
          gestureHandling="greedy" disableDefaultUI style={{ width: '100%', height: '100%' }}>
          <BoundaryMapLayer key={mapKey} cityId={0} initialBoundary={start} overlays={[]} onChange={handleChange} onError={setMapError} loadFeatureRef={loadFeatureRef} />
        </GoogleMap>
        <PlaceSearch />
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
