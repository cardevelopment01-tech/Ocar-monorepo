'use client'

import { memo } from 'react'
import { Marker } from 'react-map-gl/maplibre'

type PinVariant = 'pickup' | 'drop' | 'user'

interface LocationPinProps {
  position: [number, number]
  variant: PinVariant
}

function LocationPin({ position, variant }: LocationPinProps) {
  if (variant === 'user') {
    return (
      <Marker latitude={position[0]} longitude={position[1]} anchor="center">
        <div style={{ position: 'relative', width: 20, height: 20 }}>
          <div className="absolute inset-0 rounded-full animate-ping bg-blue-600/30" />
          <div className="relative w-5 h-5 rounded-full bg-blue-600 border-2 border-white shadow" />
        </div>
      </Marker>
    )
  }

  const isPickup = variant === 'pickup'
  const fill = isPickup ? '#2563EB' : '#0F172A'

  return (
    <Marker latitude={position[0]} longitude={position[1]} anchor="bottom">
      <div style={{ position: 'relative', width: 28, height: 38 }}>
        {isPickup && (
          <div
            className="animate-ping rounded-full bg-indigo-600/15 pointer-events-none w-10 h-10"
            style={{ position: 'absolute', top: -6, left: -6 }}
          />
        )}
        <svg width="28" height="38" viewBox="0 0 28 38" fill="none" xmlns="http://www.w3.org/2000/svg">
          <ellipse cx="14" cy="36.5" rx="5" ry="1.5" fill="rgba(0,0,0,0.18)" />
          <path
            d="M14 1C6.82 1 1 6.82 1 14C1 21.2 7.4 28.6 14 37C20.6 28.6 27 21.2 27 14C27 6.82 21.18 1 14 1Z"
            fill={fill}
            stroke="white"
            strokeWidth="2"
          />
          <circle cx="14" cy="13.5" r="4.5" fill="white" opacity="0.9" />
        </svg>
      </div>
    </Marker>
  )
}

export default memo(LocationPin, (a, b) =>
  a.variant === b.variant &&
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1]
)
