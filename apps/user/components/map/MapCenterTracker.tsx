'use client'

import { useEffect } from 'react'
import { useMap } from '@vis.gl/react-google-maps'

interface MapCenterTrackerProps {
  onCenterChange: (lat: number, lng: number) => void
  onDragStart?: () => void
}

export default function MapCenterTracker({ onCenterChange, onDragStart }: MapCenterTrackerProps) {
  const map = useMap()

  useEffect(() => {
    if (!map) return

    const dragListener = map.addListener('dragstart', () => onDragStart?.())
    const idleListener = map.addListener('idle', () => {
      const c = map.getCenter()
      if (c) onCenterChange(c.lat(), c.lng())
    })

    return () => {
      dragListener.remove()
      idleListener.remove()
    }
  }, [map, onCenterChange, onDragStart])

  return null
}
