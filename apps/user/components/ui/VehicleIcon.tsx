'use client'

import type React from 'react'

/**
 * VehicleIcon: side-profile SVG illustrations for the ride selection sheet.
 *
 * Each icon is a single monochrome silhouette using the `color` prop, rendered
 * inside a 80×44 landscape viewBox (side-profile view). Wheels use a darkened
 * shade of the same colour for contrast; windows are a translucent white.
 */

interface VehicleIconProps {
  slug: string
  /** height in px; width derived from the 80:44 aspect ratio */
  size?: number
  /** fill colour for the body silhouette */
  color?: string
  className?: string
}

const ASPECT = 80 / 44
const WINDOW_FILL = 'rgba(255,255,255,0.28)'

/**
 * Darken a hex colour by mixing it toward black. Falls back to the input for
 * non-hex colours (e.g. named/rgb), in which case wheels reuse the body colour.
 */
function shade(hex: string, factor = 0.62): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim())
  if (!m) return hex
  const int = parseInt(m[1], 16)
  const r = Math.round(((int >> 16) & 0xff) * factor)
  const g = Math.round(((int >> 8) & 0xff) * factor)
  const b = Math.round((int & 0xff) * factor)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

function Hatchback({ color, wheel }: { color: string; wheel: string }) {
  return (
    <>
      {/* 2-box compact body: short hood, tall cabin peaking centre, sharp rear slope */}
      <path
        d="M4 32 L4 27 Q4 25 7 24 L13 23 L19 14 Q21 11 25 11 L40 11 Q44 11 46 14 L62 23 L73 25 Q76 26 76 29 L76 32 Q76 34 73 34 L7 34 Q4 34 4 32 Z"
        fill={color}
      />
      {/* Cabin glass */}
      <path d="M22 22 L26 14 Q27 13 29 13 L39 13 Q41 13 42 15 L48 22 Z" fill={WINDOW_FILL} />
      {/* Door seam */}
      <line x1="35" y1="14" x2="35" y2="22" stroke={WINDOW_FILL} strokeWidth="1" />
      <circle cx="18" cy="36" r="7" fill={wheel} />
      <circle cx="60" cy="36" r="7" fill={wheel} />
      <circle cx="18" cy="36" r="3" fill={WINDOW_FILL} />
      <circle cx="60" cy="36" r="3" fill={WINDOW_FILL} />
    </>
  )
}

function Sedan({ color, wheel }: { color: string; wheel: string }) {
  return (
    <>
      {/* 3-box: hood, cabin, trunk */}
      <path
        d="M4 32 L4 28 Q4 26 8 25 L20 24 L26 14 Q28 11 33 11 L50 11 Q55 11 57 14 L62 23 L73 24 Q76 25 76 28 L76 32 Q76 34 73 34 L7 34 Q4 34 4 32 Z"
        fill={color}
      />
      {/* Cabin glass spanning hood-to-trunk */}
      <path d="M29 23 L33 14 Q34 13 36 13 L49 13 Q51 13 52 15 L57 23 Z" fill={WINDOW_FILL} />
      {/* Door seam */}
      <line x1="42" y1="14" x2="42" y2="23" stroke={WINDOW_FILL} strokeWidth="1" />
      <circle cx="18" cy="36" r="7" fill={wheel} />
      <circle cx="62" cy="36" r="7" fill={wheel} />
      <circle cx="18" cy="36" r="3" fill={WINDOW_FILL} />
      <circle cx="62" cy="36" r="3" fill={WINDOW_FILL} />
    </>
  )
}

function Suv({ color, wheel }: { color: string; wheel: string }) {
  return (
    <>
      {/* Tall boxy profile, flat roof, high ride height, squared rear */}
      <path
        d="M5 31 L5 14 Q5 11 9 11 L13 11 L16 11 Q17 9 20 9 L60 9 Q64 9 66 11 L71 12 Q76 13 76 17 L76 31 Q76 33 73 33 L8 33 Q5 33 5 31 Z"
        fill={color}
      />
      {/* Glasshouse, large, upright */}
      <path d="M20 21 L22 12 Q22 11 24 11 L58 11 Q60 11 61 12 L64 21 Z" fill={WINDOW_FILL} />
      {/* Pillar seams */}
      <line x1="34" y1="12" x2="34" y2="21" stroke={WINDOW_FILL} strokeWidth="1" />
      <line x1="48" y1="12" x2="48" y2="21" stroke={WINDOW_FILL} strokeWidth="1" />
      {/* Larger wheels with arch clearance */}
      <circle cx="18" cy="36" r="8" fill={wheel} />
      <circle cx="60" cy="36" r="8" fill={wheel} />
      <circle cx="18" cy="36" r="3.5" fill={WINDOW_FILL} />
      <circle cx="60" cy="36" r="3.5" fill={WINDOW_FILL} />
    </>
  )
}

function Luxury({ color, wheel }: { color: string; wheel: string }) {
  return (
    <>
      {/* Long, low, sloping fastback silhouette */}
      <path
        d="M4 33 L4 28 Q4 25 8 24 L22 23 L28 15 Q30 13 35 13 L52 13 Q58 13 62 16 L74 24 Q76 25 76 28 L76 33 Q76 35 73 35 L7 35 Q4 35 4 33 Z"
        fill={color}
      />
      {/* Low, long greenhouse */}
      <path d="M30 22 L34 15 Q35 14 37 14 L51 14 Q56 14 59 17 L64 22 Z" fill={WINDOW_FILL} />
      {/* Door seam */}
      <line x1="46" y1="15" x2="46" y2="22" stroke={WINDOW_FILL} strokeWidth="1" />
      <circle cx="20" cy="37" r="7" fill={wheel} />
      <circle cx="62" cy="37" r="7" fill={wheel} />
      <circle cx="20" cy="37" r="3" fill={WINDOW_FILL} />
      <circle cx="62" cy="37" r="3" fill={WINDOW_FILL} />
    </>
  )
}

function Van({ color, wheel }: { color: string; wheel: string }) {
  return (
    <>
      {/* Tall rectangular box, flat roof, near-vertical nose, flat rear */}
      <path
        d="M5 31 L5 12 Q5 9 9 9 L13 8 L70 8 Q76 8 76 13 L76 31 Q76 33 73 33 L8 33 Q5 33 5 31 Z"
        fill={color}
      />
      {/* Tall windscreen + side glass band */}
      <path d="M12 20 L13 11 Q13 10 15 10 L68 10 Q70 10 70 12 L70 20 Z" fill={WINDOW_FILL} />
      {/* Sliding door division */}
      <line x1="48" y1="10" x2="48" y2="33" stroke={WINDOW_FILL} strokeWidth="1.2" />
      {/* B-pillar seam */}
      <line x1="30" y1="11" x2="30" y2="20" stroke={WINDOW_FILL} strokeWidth="1" />
      <circle cx="18" cy="36" r="7" fill={wheel} />
      <circle cx="62" cy="36" r="7" fill={wheel} />
      <circle cx="18" cy="36" r="3" fill={WINDOW_FILL} />
      <circle cx="62" cy="36" r="3" fill={WINDOW_FILL} />
    </>
  )
}

const BODIES: Record<string, (p: { color: string; wheel: string }) => React.JSX.Element> = {
  hatchback: Hatchback,
  sedan: Sedan,
  suv: Suv,
  luxury: Luxury,
  van: Van,
}

export function VehicleIcon({ slug, size = 44, color = '#0F172A', className }: VehicleIconProps) {
  const Body = BODIES[slug] ?? Sedan
  const wheel = shade(color)
  return (
    <svg
      viewBox="0 0 80 44"
      width={size * ASPECT}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={`${slug} icon`}
    >
      <Body color={color} wheel={wheel} />
    </svg>
  )
}

export default VehicleIcon
