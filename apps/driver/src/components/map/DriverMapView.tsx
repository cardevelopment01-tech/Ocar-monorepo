import Map from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty'

interface DriverMapViewProps {
  center: [number, number]
  zoom?: number
  dimmed?: boolean
  children?: React.ReactNode
}

export default function DriverMapView({ center, zoom = 15, dimmed = false, children }: DriverMapViewProps) {
  return (
    <div className="relative w-full h-full">
      <Map
        initialViewState={{ latitude: center[0], longitude: center[1], zoom }}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
      >
        {children}
      </Map>
      {dimmed && (
        <div className="absolute inset-0 bg-bg/40 pointer-events-none" style={{ zIndex: 1 }} />
      )}
    </div>
  )
}
