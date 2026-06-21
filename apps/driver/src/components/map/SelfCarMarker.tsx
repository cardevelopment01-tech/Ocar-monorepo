import { memo } from 'react'
import { Marker } from 'react-map-gl/maplibre'

const GLASS: React.CSSProperties = {
  background:           'rgba(255,255,255,0.92)',
  backdropFilter:       'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border:               '1px solid rgba(0,0,0,0.07)',
  boxShadow:            '0 2px 12px rgba(0,0,0,0.10)',
}

interface SelfCarMarkerProps {
  position: [number, number]
  areaName?: string | null
  loading?:  boolean
  heading?:  number  // accepted for callers that track heading; pin doesn't rotate
}

function SelfCarMarker({ position, areaName = null, loading = false }: SelfCarMarkerProps) {
  const showLabel = areaName !== null || loading

  return (
    <Marker latitude={position[0]} longitude={position[1]} anchor="bottom">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>

        {/* ── Label pill + connecting caret ── */}
        {showLabel && (
          <>
            <div style={{
              ...GLASS,
              borderRadius: 9999,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              paddingLeft: 6,
              paddingRight: 10,
              paddingTop: 4,
              paddingBottom: 4,
              maxWidth: 180,
            }}>
              {/* Dark mini-pin badge */}
              <span style={{
                width: 16, height: 16, borderRadius: '50%',
                background: '#0F172A',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <svg width="8" height="9" viewBox="0 0 8 9" fill="none">
                  <circle cx="4" cy="3.5" r="2.5" fill="white" />
                  <path d="M4 6L2.5 8H5.5L4 6Z" fill="white" />
                </svg>
              </span>

              {/* Text or loading skeleton */}
              {loading && !areaName ? (
                <div style={{
                  width: 72, height: 10, borderRadius: 5,
                  background: 'rgba(15,23,42,0.10)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }} />
              ) : (
                <span style={{
                  fontSize: 11.5, fontWeight: 600, color: '#0F172A',
                  lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {areaName}
                </span>
              )}
            </div>

            {/* Caret connects pill to pin */}
            <div style={{
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid rgba(255,255,255,0.92)',
              marginTop: -1,
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.08))',
            }} />
          </>
        )}

        {/* ── Teardrop pin ── */}
        {/* car paths use transform="translate(6,4.5) scale(0.75)" to fit the white circle */}
        <svg width="36" height="46" viewBox="0 0 36 46" fill="none" style={{ display: 'block' }}>
          {/* Ground shadow */}
          <ellipse cx="18" cy="44" rx="5" ry="2" fill="rgba(0,0,0,0.18)" />
          {/* Dark slate pin body */}
          <path
            d="M18 2C9.7 2 3 8.6 3 17C3 26.4 14.2 37.6 17.1 40.3a1.3 1.3 0 0 0 1.8 0C21.8 37.6 33 26.4 33 17C33 8.6 26.3 2 18 2Z"
            fill="#1E293B"
            stroke="#FFFFFF"
            strokeWidth="1.5"
          />
          {/* White head circle */}
          <circle cx="18" cy="16.5" r="9" fill="white" />
          {/* Car icon — scaled to fit inside the white head */}
          <g transform="translate(6,4.5) scale(0.75)">
            <path d="M9.5 16L11.5 12C11.9 11.1 12.8 10.5 13.8 10.5H18.2C19.2 10.5 20.1 11.1 20.5 12L22.5 16" fill="#1E293B" />
            <rect x="9" y="16" width="14" height="3.5" rx="1.5" fill="#1E293B" />
            <path d="M10 19.5H22" stroke="#1E293B" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M11 19.5V21.5" stroke="#1E293B" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M21 19.5V21.5" stroke="#1E293B" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="10" y="12.5" width="3.5" height="1.5" rx="0.5" fill="rgba(255,255,255,0.55)" />
            <rect x="18.5" y="12.5" width="3.5" height="1.5" rx="0.5" fill="rgba(255,255,255,0.55)" />
          </g>
        </svg>

      </div>
    </Marker>
  )
}

export default memo(SelfCarMarker, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  a.areaName    === b.areaName    &&
  a.loading     === b.loading     &&
  a.heading     === b.heading
)
