'use client'

import { memo, useEffect, useRef } from 'react'
import { AdvancedMarker, useAdvancedMarkerRef } from '@vis.gl/react-google-maps'
import { COLORS } from '@/lib/colors'
import type { ActiveDriverSession } from '@/lib/admin-api'
import { STAGE_META, type Stage } from '@/lib/live-map-model'
import { driverGlider } from '@/lib/marker-glide'

// Memoized on the session, stage and selection only (not `onClick`, a fresh closure every parent render), so a marker re-renders when ITS
// driver changes, not on every other driver's update.
export const DriverDot = memo(function DriverDot({ session, stage, selected, onClick }: { session: ActiveDriverSession; stage: Stage; selected: boolean; onClick: () => void }) {
  // The colour says where the driver is (same colours as the list chips). A driver who stopped sending location is grey and dimmed
  // so a frozen dot is never mistaken for a live one.
  const stale = stage === 'no_location'
  // On a trip with no location is the case ops must not miss: a red ring, not a dimmed dot. A silent idle driver just fades.
  const alarm = stale && session.session_status === 'on_trip'
  const color = STAGE_META[stage].color

  // The position prop is only the starting point. After that the shared glider moves the marker itself (no React render per frame), so the
  // prop must stay the same object: a new one would snap the marker back.
  const [markerRef, marker] = useAdvancedMarkerRef()
  const start = useRef({ lat: session.lat!, lng: session.lng! })
  const id = session.driver_id
  const { lat, lng } = session
  useEffect(() => { if (marker && lat != null && lng != null) driverGlider.moveTo(id, marker, lat, lng) }, [marker, id, lat, lng])
  useEffect(() => () => driverGlider.remove(id), [id])

  return (
    <AdvancedMarker
      ref={markerRef}
      position={start.current}
      onClick={onClick}
      zIndex={selected ? 1000 : alarm ? 500 : stale ? 0 : 1}
    >
      <div style={{ position: 'relative', width: 28, height: 28, cursor: 'pointer', opacity: stale && !alarm ? 0.65 : 1, outline: selected ? `3px solid ${COLORS.primary}` : alarm ? `3px solid ${COLORS.danger}` : undefined, outlineOffset: 3, borderRadius: '50%' }}>
        {/* Halo */}
        <div style={{ position: 'absolute', inset: -6, borderRadius: '50%', background: color, opacity: 0.18 }} />
        {/* Solid dot */}
        <div style={{ width: 28, height: 28, borderRadius: '50%', background: color, border: '2.5px solid #ffffff', boxShadow: '0 2px 6px rgba(0,0,0,0.22)', position: 'relative' }} />
      </div>
    </AdvancedMarker>
  )
}, (prev, next) => prev.session === next.session && prev.stage === next.stage && prev.selected === next.selected)
