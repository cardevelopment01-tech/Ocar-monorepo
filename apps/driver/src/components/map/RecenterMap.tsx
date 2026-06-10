import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'

interface RecenterMapProps {
  center: [number, number]
  animate?: boolean
}

/**
 * Keeps a Leaflet map centered on `center` after mount. MapContainer ignores
 * `center` prop changes once created, so without this the driver map freezes
 * on its first position and never follows the driver.
 */
export default function RecenterMap({ center, animate = true }: RecenterMapProps) {
  const map = useMap()
  const last = useRef<[number, number] | null>(null)

  useEffect(() => {
    const [lat, lng] = center
    const prev = last.current
    if (prev && Math.abs(prev[0] - lat) < 2e-5 && Math.abs(prev[1] - lng) < 2e-5) return
    last.current = [lat, lng]
    map.panTo([lat, lng], { animate, duration: 0.6, easeLinearity: 0.25 })
  }, [center, map, animate])

  return null
}
