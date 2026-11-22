'use client'

import { useEffect, useRef } from 'react'
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps'
import { Search } from 'lucide-react'

// Jump the map to a searched place (e.g. "Biju Patnaik International Airport", "Cuttack") so the admin does not have to pan there by hand.
// Sits on top of a <Map id={mapId}>; the id is how this component, rendered beside the map, finds it.
export default function MapPlaceSearch({ mapId, placeholder }: { mapId: string; placeholder: string }) {
  const map = useMap(mapId)
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
        <input ref={inputRef} type="text" aria-label="Search for a place on the map" placeholder={placeholder}
          // Enter must pick a suggestion, not submit a form behind the map.
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }}
          className="w-full border border-border rounded-xl pl-9 pr-3 py-2 text-sm text-text-primary bg-surface shadow-card focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted" />
      </div>
    </div>
  )
}
