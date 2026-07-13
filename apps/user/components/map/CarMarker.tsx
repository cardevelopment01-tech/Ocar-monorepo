'use client'

import { memo } from 'react'
import { AdvancedMarker, AdvancedMarkerAnchorPoint } from '@vis.gl/react-google-maps'

interface CarMarkerProps {
  position: [number, number]
  heading?: number
  /** False until a real bearing has been derived from two GPS fixes (see useInterpolatedPosition). */
  headingKnown?: boolean
}

function CarMarker({ position, heading = 0, headingKnown = true }: CarMarkerProps) {
  const rotation = heading % 360
  return (
    // Anchor at the icon's own center, not the library default (bottom-center):
    // the inner div below rotates around its own center (default transform-origin),
    // so anchoring anywhere else makes the visible car drift sideways off the true
    // GPS coordinate as heading turns away from 0/180° — read as "car in the wrong
    // lane" (see docs/DRIVER_USER_MAP_UX_FIX_PLAN.md Phase 7c).
    <AdvancedMarker position={{ lat: position[0], lng: position[1] }} anchorPoint={AdvancedMarkerAnchorPoint.CENTER}>
      <div
        style={{
          width: 22,
          height: 36,
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 0.4s cubic-bezier(0.22,1,0.36,1), opacity 0.4s ease-out',
          // Neutral/undirected until a real bearing exists, instead of a fake 0°/north snap.
          opacity: headingKnown ? 1 : 0.55,
          filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.35))',
        }}
      >
        <svg viewBox="0 0 32 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
          <path
            d="M4,20 C4,11 8,4 16,4 C24,4 28,11 28,20 L28,42 C28,48 23,51 16,51 C9,51 4,48 4,42 Z"
            fill="#1E293B"
          />
          <path d="M8,8 L24,8 L25,18 L7,18 Z" fill="rgba(255,255,255,0.82)" />
          <line x1="8" y1="8" x2="24" y2="8" stroke="rgba(255,255,255,0.20)" strokeWidth="1" />
          <rect x="7" y="20" width="18" height="12" rx="2" fill="rgba(255,255,255,0.07)" />
          <line x1="5" y1="29" x2="27" y2="29" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />
          <rect x="9" y="36" width="14" height="8" rx="2" fill="rgba(255,255,255,0.30)" />
          <circle cx="9"  cy="7" r="2"   fill="#FCD34D" />
          <circle cx="23" cy="7" r="2"   fill="#FCD34D" />
          <circle cx="9"  cy="47" r="1.5" fill="#F87171" opacity="0.80" />
          <circle cx="23" cy="47" r="1.5" fill="#F87171" opacity="0.80" />
        </svg>
      </div>
    </AdvancedMarker>
  )
}

export default memo(CarMarker, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  (a.heading ?? 0) === (b.heading ?? 0) &&
  (a.headingKnown ?? true) === (b.headingKnown ?? true)
)
