import { memo } from 'react'
import { Marker } from 'react-leaflet'
import L from 'leaflet'

const CAR_SVG = `
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="16" fill="#1D4ED8" fill-opacity="0.95"/>
    <path d="M10 19H22M11 19V21M21 19V21" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M9.5 16L11.5 12C11.9 11.1 12.8 10.5 13.8 10.5H18.2C19.2 10.5 20.1 11.1 20.5 12L22.5 16H9.5Z" fill="white"/>
    <rect x="9" y="16" width="14" height="4" rx="1.5" fill="white"/>
    <rect x="10" y="13" width="3.5" height="1.5" rx="0.5" fill="#93C5FD"/>
    <rect x="18.5" y="13" width="3.5" height="1.5" rx="0.5" fill="#93C5FD"/>
  </svg>
`

const ICON_CACHE = new Map<number, L.DivIcon>()

function getSelfCarIcon(heading: number): L.DivIcon {
  const bucket = (Math.round(heading / 5) * 5) % 360
  let icon = ICON_CACHE.get(bucket)
  if (!icon) {
    icon = L.divIcon({
      html: `<div style="transform:rotate(${bucket}deg);transition:transform 0.5s ease-out;width:32px;height:32px;">${CAR_SVG}</div>`,
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    })
    ICON_CACHE.set(bucket, icon)
  }
  return icon
}

function SelfCarMarker({ position, heading = 0 }: { position: [number, number]; heading?: number }) {
  return <Marker position={position} icon={getSelfCarIcon(heading)} />
}

export default memo(SelfCarMarker, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  a.heading === b.heading
)
