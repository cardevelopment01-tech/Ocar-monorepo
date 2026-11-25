'use client'

import { memo } from 'react'
import { AdvancedMarker } from '@vis.gl/react-google-maps'
import { Clock, Flag, ShieldAlert } from 'lucide-react'
import { COLORS } from '@/lib/colors'
import type { AttentionItem } from '@/lib/live-map-attention'

// Three shapes as well as three colours, so they read at a glance and without telling red from amber:
// SOS = red square, flagged ride = amber diamond, unmet request = purple dashed circle. An unacknowledged SOS pulses.
export const AttentionMarker = memo(function AttentionMarker({ item, selected, onClick }: { item: AttentionItem; selected: boolean; onClick: () => void }) {
  const ring = selected ? `3px solid ${COLORS.primary}` : undefined
  return (
    <AdvancedMarker position={{ lat: item.lat, lng: item.lng }} onClick={onClick} zIndex={selected ? 1100 : item.kind === 'sos' ? 900 : item.kind === 'flagged' ? 600 : 400} title={item.title}>
      {/* A flagged ride sits exactly on its driver's last position, so the diamond is nudged up and right to stay visible beside the dot. */}
      <div className="relative cursor-pointer" style={{ width: 30, height: 30, transform: item.kind === 'flagged' ? 'translate(16px, -16px)' : undefined }}>
        {item.urgent && <span className="absolute inset-0 animate-ping rounded-md bg-danger opacity-50" aria-hidden />}
        {item.kind === 'sos' && (
          <div className="relative flex h-[30px] w-[30px] items-center justify-center rounded-md border-2 border-white bg-danger text-white shadow-md" style={{ outline: ring, outlineOffset: 2 }}>
            <ShieldAlert size={17} aria-hidden />
          </div>
        )}
        {item.kind === 'flagged' && (
          <div className="flex h-[26px] w-[26px] rotate-45 items-center justify-center border-2 border-white bg-warning text-white shadow-md" style={{ margin: 2, outline: ring, outlineOffset: 2 }}>
            <Flag size={14} className="-rotate-45" aria-hidden />
          </div>
        )}
        {item.kind === 'request' && (
          <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white shadow-md" style={{ border: `2px dashed ${COLORS.purple}`, color: COLORS.purple, outline: ring, outlineOffset: 2 }}>
            <Clock size={15} aria-hidden />
          </div>
        )}
      </div>
    </AdvancedMarker>
  )
})
