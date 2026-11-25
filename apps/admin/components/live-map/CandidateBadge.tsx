'use client'

import { memo } from 'react'
import { AdvancedMarker } from '@vis.gl/react-google-maps'
import { COLORS } from '@/lib/colors'
import type { MarkedDriver } from '@/lib/live-map-dispatch'

// "1  850 m" beside a driver's dot while a ride is being assigned: who the nearest available drivers are and how far from the pickup.
// Sits beside the dot (right, above for odd ranks and below for even) so the dot underneath stays visible and the labels of neighbouring ranks,
// whose drivers are often bunched together, do not land on top of each other.
export const CandidateBadge = memo(function CandidateBadge({ marked, lat, lng }: { marked: MarkedDriver; lat: number; lng: number }) {
  return (
    <AdvancedMarker position={{ lat, lng }} zIndex={1200} clickable={false}>
      <div className="flex items-center gap-1 rounded-full bg-white py-0.5 pl-0.5 pr-2 shadow-md" style={{ transform: `translate(22px, ${marked.rank % 2 === 1 ? -22 : 10}px)`, border: `2px solid ${COLORS.purple}` }} aria-label={`Nearest driver ${marked.rank}, ${marked.label} from the pickup`}>
        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: COLORS.purple }}>{marked.rank}</span>
        <span className="text-[11px] font-semibold text-text-primary">{marked.label}</span>
      </div>
    </AdvancedMarker>
  )
}, (a, b) => a.marked === b.marked && a.lat === b.lat && a.lng === b.lng)
