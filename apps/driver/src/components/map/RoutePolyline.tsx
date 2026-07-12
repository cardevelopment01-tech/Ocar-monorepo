import { useMemo } from 'react'
import { Polyline } from '@vis.gl/react-google-maps'
import { decodePolyline } from '@/lib/polyline'

const ARROW_ICON = {
  path: 'M -2,-3 2,0 -2,3',
  strokeColor: '#ffffff',
  strokeWeight: 2,
  strokeOpacity: 0.85,
  fillOpacity: 0,
  scale: 3,
}

interface RoutePolylineProps {
  encoded?: string
  positions?: [number, number][]
}

export default function RoutePolyline({ encoded, positions }: RoutePolylineProps) {
  const pts = useMemo<[number, number][]>(() => {
    if (encoded) return decodePolyline(encoded)
    if (positions && positions.length >= 3) return positions
    return []
  }, [encoded, positions])

  const path = useMemo(
    () => pts.map(([lat, lng]) => ({ lat, lng })),
    [pts]
  )

  if (pts.length < 2) return null

  return (
    <>
      <Polyline
        path={path}
        strokeColor="#ffffff"
        strokeWeight={11}
        strokeOpacity={0.9}
        zIndex={1}
      />
      <Polyline
        path={path}
        strokeColor="#1A73E8"
        strokeWeight={7}
        strokeOpacity={1}
        zIndex={2}
        icons={[{ icon: ARROW_ICON, repeat: '80px' }]}
      />
    </>
  )
}
