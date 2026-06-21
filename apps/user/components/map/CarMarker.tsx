'use client'

import { memo } from 'react'
import { Marker } from 'react-map-gl/maplibre'

interface CarMarkerProps {
  position: [number, number]
  heading?: number
}

/**
 * CarMarker — premium top-down car marker for the live map.
 *
 * The SVG points UP at heading=0; CSS `rotate` applies the live heading so the
 * car aligns with travel direction. Heading is bucketed to 5° to limit
 * re-renders and the transform is animated for a smooth, Uber/Rapido-style glide.
 */
function CarMarker({ position, heading = 0 }: CarMarkerProps) {
  const rotation = (Math.round(heading / 5) * 5) % 360
  return (
    <Marker latitude={position[0]} longitude={position[1]} anchor="center">
      <div
        style={{
          width: 40,
          height: 56,
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 0.4s cubic-bezier(0.22,1,0.36,1)',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.22))',
        }}
      >
        <svg
          viewBox="0 0 40 56"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ width: '100%', height: '100%' }}
        >
          {/* Direction indicator — points UP, removes any heading ambiguity */}
          <path d="M20 1 L24 8 L16 8 Z" fill="#4F46E5" />

          {/* Car body — rounded capsule, slightly tapered at front/rear */}
          <path
            d="M20 5 C28 5 34 12 34 24 C34 36 28 51 20 51 C12 51 6 36 6 24 C6 12 12 5 20 5 Z"
            fill="#FFFFFF"
            stroke="rgba(0,0,0,0.12)"
            strokeWidth="1"
          />

          {/* Windshield (front) */}
          <rect x="11" y="9" width="18" height="9" rx="4" fill="rgba(79,70,229,0.18)" />

          {/* Roof / cabin highlight */}
          <rect x="12" y="20" width="16" height="9" rx="3" fill="rgba(0,0,0,0.04)" />

          {/* Door division line */}
          <line x1="7" y1="28" x2="33" y2="28" stroke="rgba(0,0,0,0.06)" strokeWidth="1" />

          {/* Rear window */}
          <rect x="13" y="38" width="14" height="7" rx="3" fill="rgba(79,70,229,0.10)" />
        </svg>
      </div>
    </Marker>
  )
}

export default memo(
  CarMarker,
  (a, b) =>
    a.position[0] === b.position[0] &&
    a.position[1] === b.position[1] &&
    Math.round((a.heading ?? 0) / 5) === Math.round((b.heading ?? 0) / 5)
)
