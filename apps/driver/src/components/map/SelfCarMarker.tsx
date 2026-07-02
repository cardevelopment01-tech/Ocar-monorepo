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
  const rotation  = heading % 360

  return (
    <Marker latitude={position[0]} longitude={position[1]} anchor="center">
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>

        {/* ── Label pill — floats above, never rotates ── */}
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

            {/* Caret */}
            <svg width="10" height="5" viewBox="0 0 10 5" fill="none" style={{ marginTop: -1, filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.08))' }}>
              <path d="M0 0L5 5L10 0Z" fill="rgba(255,255,255,0.92)" />
            </svg>
          </div>
        )}

        {/* ── Dark car body — rotates with heading ── */}
        <div style={{
          width: 32,
          height: 52,
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 0.4s cubic-bezier(0.22,1,0.36,1)',
          filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.35))',
        }}>
          <svg viewBox="0 0 32 52" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: '100%' }}>
            {/* Car body — dark slate */}
            <path
              d="M4,20 C4,11 8,4 16,4 C24,4 28,11 28,20 L28,42 C28,48 23,51 16,51 C9,51 4,48 4,42 Z"
              fill="#1E293B"
            />

            {/* Windshield — large, bright, front direction cue */}
            <path d="M8,8 L24,8 L25,18 L7,18 Z" fill="rgba(255,255,255,0.82)" />

            {/* Hood line */}
            <line x1="8" y1="8" x2="24" y2="8" stroke="rgba(255,255,255,0.20)" strokeWidth="1" />

            {/* Cabin area */}
            <rect x="7" y="20" width="18" height="12" rx="2" fill="rgba(255,255,255,0.07)" />

            {/* Door divider */}
            <line x1="5" y1="29" x2="27" y2="29" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />

            {/* Rear window */}
            <rect x="9" y="36" width="14" height="8" rx="2" fill="rgba(255,255,255,0.30)" />

            {/* Headlights — amber */}
            <circle cx="9"  cy="7" r="2"   fill="#FCD34D" />
            <circle cx="23" cy="7" r="2"   fill="#FCD34D" />

            {/* Tail lights — red */}
            <circle cx="9"  cy="47" r="1.5" fill="#F87171" opacity="0.80" />
            <circle cx="23" cy="47" r="1.5" fill="#F87171" opacity="0.80" />
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
  (a.heading ?? 0) === (b.heading ?? 0)
)
