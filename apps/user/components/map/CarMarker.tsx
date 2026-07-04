'use client'

import { memo } from 'react'
import { Marker } from 'react-map-gl/maplibre'

interface CarMarkerProps {
  position: [number, number]
  heading?: number
}

function CarMarker({ position, heading = 0 }: CarMarkerProps) {
  const rotation = heading % 360
  return (
    <Marker latitude={position[0]} longitude={position[1]} anchor="center">
      <div
        style={{
          width: 32,
          height: 52,
          transform: `rotate(${rotation}deg)`,
          filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.35))',
        }}
      >
        <svg viewBox="0 0 32 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
          {/* Car body — dark slate, tapered at front, squared at rear */}
          <path
            d="M4,20 C4,11 8,4 16,4 C24,4 28,11 28,20 L28,42 C28,48 23,51 16,51 C9,51 4,48 4,42 Z"
            fill="#1E293B"
          />

          {/* Windshield — large bright window at front; primary direction cue */}
          <path d="M8,8 L24,8 L25,18 L7,18 Z" fill="rgba(255,255,255,0.82)" />

          {/* Hood highlight line between windshield and bumper */}
          <line x1="8" y1="8" x2="24" y2="8" stroke="rgba(255,255,255,0.20)" strokeWidth="1" />

          {/* Cabin / roof centre — subtle lighter area */}
          <rect x="7" y="20" width="18" height="12" rx="2" fill="rgba(255,255,255,0.07)" />

          {/* Door divider */}
          <line x1="5" y1="29" x2="27" y2="29" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />

          {/* Rear window — smaller, clearly rear */}
          <rect x="9" y="36" width="14" height="8" rx="2" fill="rgba(255,255,255,0.30)" />

          {/* Headlights — amber, front corners */}
          <circle cx="9"  cy="7" r="2"   fill="#FCD34D" />
          <circle cx="23" cy="7" r="2"   fill="#FCD34D" />

          {/* Tail lights — red, rear corners */}
          <circle cx="9"  cy="47" r="1.5" fill="#F87171" opacity="0.80" />
          <circle cx="23" cy="47" r="1.5" fill="#F87171" opacity="0.80" />
        </svg>
      </div>
    </Marker>
  )
}

export default memo(CarMarker, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  (a.heading ?? 0) === (b.heading ?? 0)
)
