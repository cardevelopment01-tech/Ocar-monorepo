'use client'

import { memo } from 'react'
import { Marker } from 'react-map-gl/maplibre'

interface CarMarkerProps {
  position: [number, number]
  heading?: number
}

const CAR_SVG = `<svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="14" cy="14" r="14" fill="white" fill-opacity="0.9"/>
  <path d="M9 17H19M10 17V19M18 17V19" stroke="#1E293B" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M8.5 14L10 10.5C10.4 9.6 11.2 9 12.2 9H15.8C16.8 9 17.6 9.6 18 10.5L19.5 14H8.5Z" fill="#1E293B"/>
  <rect x="8" y="14" width="12" height="4" rx="1.5" fill="#1E293B"/>
  <rect x="9" y="11" width="3" height="1.5" rx="0.5" fill="#7DD3FC"/>
  <rect x="16" y="11" width="3" height="1.5" rx="0.5" fill="#7DD3FC"/>
</svg>`

function CarMarker({ position, heading = 0 }: CarMarkerProps) {
  const bucket = (Math.round(heading / 5) * 5) % 360
  return (
    <Marker latitude={position[0]} longitude={position[1]} anchor="center">
      <div
        style={{ width: 28, height: 28, transform: `rotate(${bucket}deg)`, transition: 'transform 0.5s ease-out' }}
        dangerouslySetInnerHTML={{ __html: CAR_SVG }}
      />
    </Marker>
  )
}

export default memo(CarMarker, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  a.heading === b.heading
)
