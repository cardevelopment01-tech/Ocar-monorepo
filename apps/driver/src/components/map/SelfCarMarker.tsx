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
  heading?:  number
}

function SelfCarMarker({ position, areaName = null, loading = false, heading = 0 }: SelfCarMarkerProps) {
  const showLabel = areaName !== null || loading
  const rotation  = (Math.round(heading / 5) * 5) % 360

  return (
    <Marker latitude={position[0]} longitude={position[1]} anchor="center">
      {/*
        Label pill is positioned above the car via absolute so only the car
        body rotates — text always stays upright regardless of heading.
      */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

        {/* ── Label pill + caret — floats above, never rotates ── */}
        {showLabel && (
          <div style={{
            position: 'absolute',
            bottom: '100%',
            marginBottom: 6,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            pointerEvents: 'none',
          }}>
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

            {/* Caret connecting pill to car */}
            <div style={{
              width: 0, height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              borderTop: '5px solid rgba(255,255,255,0.92)',
              marginTop: -1,
              filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.08))',
            }} />
          </div>
        )}

        {/* ── Premium top-down car — rotates with heading ── */}
        <div style={{
          width: 40,
          height: 56,
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 0.4s cubic-bezier(0.22,1,0.36,1)',
          filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.22))',
        }}>
          <svg viewBox="0 0 40 56" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
            {/* Direction indicator — slate-900 triangle, points UP at heading=0 */}
            <path d="M20 1 L24 8 L16 8 Z" fill="#0F172A" />

            {/* Car body — white rounded capsule */}
            <path
              d="M20 5 C28 5 34 12 34 24 C34 36 28 51 20 51 C12 51 6 36 6 24 C6 12 12 5 20 5 Z"
              fill="#FFFFFF"
              stroke="rgba(0,0,0,0.12)"
              strokeWidth="1"
            />

            {/* Windshield (front) — slate tint */}
            <rect x="11" y="9" width="18" height="9" rx="4" fill="rgba(15,23,42,0.14)" />

            {/* Roof / cabin highlight */}
            <rect x="12" y="20" width="16" height="9" rx="3" fill="rgba(0,0,0,0.04)" />

            {/* Door division line */}
            <line x1="7" y1="28" x2="33" y2="28" stroke="rgba(0,0,0,0.06)" strokeWidth="1" />

            {/* Rear window — slate tint */}
            <rect x="13" y="38" width="14" height="7" rx="3" fill="rgba(15,23,42,0.08)" />
          </svg>
        </div>

      </div>
    </Marker>
  )
}

export default memo(SelfCarMarker, (a, b) =>
  a.position[0] === b.position[0] &&
  a.position[1] === b.position[1] &&
  a.areaName    === b.areaName    &&
  a.loading     === b.loading     &&
  Math.round((a.heading ?? 0) / 5) === Math.round((b.heading ?? 0) / 5)
)
