'use client'

import { useMapEvents } from 'react-leaflet'

interface MapCenterTrackerProps {
  onCenterChange: (lat: number, lng: number) => void
}

export default function MapCenterTracker({ onCenterChange }: MapCenterTrackerProps) {
  useMapEvents({
    moveend(e) {
      const c = e.target.getCenter()
      onCenterChange(c.lat, c.lng)
    },
  })
  return null
}
