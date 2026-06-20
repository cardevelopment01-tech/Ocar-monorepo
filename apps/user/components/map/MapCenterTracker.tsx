'use client'

import { useMapEvents } from 'react-leaflet'

interface MapCenterTrackerProps {
  onCenterChange: (lat: number, lng: number) => void
  onDragStart?: () => void
}

export default function MapCenterTracker({ onCenterChange, onDragStart }: MapCenterTrackerProps) {
  useMapEvents({
    movestart() {
      onDragStart?.()
    },
    moveend(e) {
      const c = e.target.getCenter()
      onCenterChange(c.lat, c.lng)
    },
  })
  return null
}
