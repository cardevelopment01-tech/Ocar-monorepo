'use client'

import { useEffect } from 'react'
import { useMap } from 'react-map-gl/maplibre'

interface MapCenterTrackerProps {
  onCenterChange: (lat: number, lng: number) => void
  onDragStart?: () => void
}

export default function MapCenterTracker({ onCenterChange, onDragStart }: MapCenterTrackerProps) {
  const { current: map } = useMap()

  useEffect(() => {
    if (!map) return
    const handleMoveStart = () => onDragStart?.()
    const handleMoveEnd = () => {
      const c = map.getCenter()
      onCenterChange(c.lat, c.lng)
    }
    map.on('movestart', handleMoveStart)
    map.on('moveend', handleMoveEnd)
    return () => {
      map.off('movestart', handleMoveStart)
      map.off('moveend', handleMoveEnd)
    }
  }, [map, onCenterChange, onDragStart])

  return null
}
