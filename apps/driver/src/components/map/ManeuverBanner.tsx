import { memo } from 'react'
import {
  ArrowUp, ArrowLeft, ArrowRight, CornerUpLeft, CornerUpRight,
  RotateCw, Milestone, Flag,
} from 'lucide-react'
import { GLASS } from '@/lib/constants'
import type { RouteStep } from '@/lib/ride-api'

function maneuverIcon(type: string) {
  switch (type) {
    case 'turn-left':
    case 'turn-sharp-left':
    case 'uturn-left':
      return ArrowLeft
    case 'turn-right':
    case 'turn-sharp-right':
    case 'uturn-right':
      return ArrowRight
    case 'turn-slight-left':
    case 'keep-left':
    case 'fork-left':
    case 'ramp-left':
      return CornerUpLeft
    case 'turn-slight-right':
    case 'keep-right':
    case 'fork-right':
    case 'ramp-right':
      return CornerUpRight
    case 'roundabout-left':
    case 'roundabout-right':
      return RotateCw
    case 'merge':
      return Milestone
    case 'arrive':
      return Flag
    default:
      return ArrowUp
  }
}

function fmtDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`
  return `${(m / 1000).toFixed(1)} km`
}

interface ManeuverBannerProps {
  step: RouteStep | null
  distanceMetres: number | null
  isReconnecting: boolean
}

// Glanceability requirements (dashboard-mounted phone, driver glancing while moving):
// large high-contrast icon + distance, no interactive controls here — see
// docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md Phase 1 item 4.
function ManeuverBanner({ step, distanceMetres, isReconnecting }: ManeuverBannerProps) {
  if (!step) return null
  const Icon = maneuverIcon(step.maneuverType)

  return (
    <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={GLASS}>
      <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center flex-shrink-0" aria-hidden>
        <Icon size={26} className="text-text-inverse" strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0">
        {distanceMetres != null && (
          <p className="text-text-primary font-black text-lg leading-tight">{fmtDistance(distanceMetres)}</p>
        )}
        <p className="text-text-secondary text-sm font-semibold truncate">{step.instruction}</p>
        {isReconnecting && (
          <p className="text-[10px] font-bold uppercase tracking-wide mt-0.5" style={{ color: '#D97706' }}>
            Reconnecting…
          </p>
        )}
      </div>
    </div>
  )
}

export default memo(ManeuverBanner, (a, b) =>
  a.step?.instruction === b.step?.instruction &&
  a.step?.maneuverType === b.step?.maneuverType &&
  Math.round((a.distanceMetres ?? -1) / 10) === Math.round((b.distanceMetres ?? -1) / 10) &&
  a.isReconnecting === b.isReconnecting
)
