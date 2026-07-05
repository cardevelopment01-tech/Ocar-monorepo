'use client'

import { Map } from '@vis.gl/react-google-maps'

const ODISHA_BOUNDS = { north: 23.0, south: 17.5, east: 88.5, west: 82.0 }

// Clean minimal map style — white roads, off-white canvas, hidden POIs.
// Matches the look used by Uber/Rapido/Ola. Applied via raster style JSON
// (no mapId) so the same AdvancedMarker HTML markers still render fine.
const MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry',            stylers: [{ color: '#f5f4f0' }] },
  { elementType: 'labels.text.stroke',  stylers: [{ color: '#f5f4f0' }] },
  { elementType: 'labels.text.fill',    stylers: [{ color: '#555555' }] },
  { featureType: 'road',                elementType: 'geometry',        stylers: [{ color: '#ffffff' }] },
  { featureType: 'road',                elementType: 'geometry.stroke', stylers: [{ color: '#e0ddd6' }] },
  { featureType: 'road.highway',        elementType: 'geometry',        stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway',        elementType: 'geometry.stroke', stylers: [{ color: '#c8c4bb' }] },
  { featureType: 'road.highway',        elementType: 'labels.text.fill',stylers: [{ color: '#555555' }] },
  { featureType: 'road.arterial',       elementType: 'labels.text.fill',stylers: [{ color: '#777777' }] },
  { featureType: 'road.local',          elementType: 'labels.text.fill',stylers: [{ color: '#888888' }] },
  { featureType: 'water',               elementType: 'geometry',        stylers: [{ color: '#c9e8f5' }] },
  { featureType: 'water',               elementType: 'labels.text.fill',stylers: [{ color: '#9e9e9e' }] },
  { featureType: 'landscape',           elementType: 'geometry',        stylers: [{ color: '#ece9e3' }] },
  { featureType: 'landscape.man_made',  elementType: 'geometry',        stylers: [{ color: '#f5f4f0' }] },
  { featureType: 'poi.park',            elementType: 'geometry',        stylers: [{ color: '#e2eede' }] },
  { featureType: 'poi.park',            elementType: 'labels.text.fill',stylers: [{ color: '#aaaaaa' }] },
  { featureType: 'poi',                 elementType: 'labels',          stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business',        stylers: [{ visibility: 'off' }] },
  { featureType: 'transit',             elementType: 'geometry',        stylers: [{ color: '#eeeeee' }] },
  { featureType: 'transit.station',     elementType: 'labels',          stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative',      elementType: 'geometry.stroke', stylers: [{ color: '#c8c4bb' }] },
  { featureType: 'administrative.land_parcel', elementType: 'labels',  stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
]

interface MapViewInnerProps {
  center: [number, number]
  zoom: number
  className?: string
  children?: React.ReactNode
}

export default function MapViewInner({ center, zoom, className, children }: MapViewInnerProps) {
  return (
    <div className={className ?? 'w-full h-full'} style={{ height: '100%', width: '100%' }}>
      <Map
        defaultCenter={{ lat: center[0], lng: center[1] }}
        defaultZoom={zoom}
        styles={MAP_STYLE}
        gestureHandling="greedy"
        disableDefaultUI
        restriction={{ latLngBounds: ODISHA_BOUNDS, strictBounds: false }}
        style={{ height: '100%', width: '100%' }}
      >
        {children}
      </Map>
    </div>
  )
}
