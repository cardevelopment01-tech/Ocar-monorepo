'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ArrowLeft, MapPin } from 'lucide-react'
import dynamic from 'next/dynamic'
import { AdvancedMarker, Circle, Polyline } from '@vis.gl/react-google-maps'
import OcarSpinner from '@/components/ui/OcarSpinner'
import { geoApi } from '@/lib/geo-api'
import { haversineMetres } from '@/lib/geo'

const MapViewInner = dynamic(() => import('@/components/ui/MapViewInner'), { ssr: false })

// Mirrors api/src/constants/limits.ts's PICKUP_EDIT_RADIUS_METRES. This copy is
// UX feedback only (the vignette, the boundary pill) — the server re-validates
// with its own constant and never trusts a client-only radius.
const PICKUP_EDIT_RADIUS_METRES = 150
const EDIT_ZOOM = 18

function clampToRadius(
  origin: [number, number],
  point: [number, number],
  radiusMetres: number
): [number, number] {
  const dist = haversineMetres(origin, point)
  if (dist <= radiusMetres) return point
  const t = radiusMetres / dist
  return [origin[0] + (point[0] - origin[0]) * t, origin[1] + (point[1] - origin[1]) * t]
}

type Props = {
  open: boolean
  onClose: () => void
  originLat: number
  originLng: number
  originAddress: string | null
  userPos?: [number, number]
  driverAssigned: boolean
  confirming: boolean
  error: string | null
  onConfirm: (pickup: { lat: number; lng: number; address: string | null }) => void
}

export default function EditPickupSheet({
  open, onClose, originLat, originLng, originAddress, userPos, driverAssigned, confirming, error, onConfirm,
}: Props) {
  const reduce = useReducedMotion()
  const origin: [number, number] = [originLat, originLng]

  const [pinPos, setPinPos]       = useState<[number, number]>(origin)
  const [address, setAddress]     = useState<string | null>(originAddress)
  const [geocoding, setGeocoding] = useState(false)
  const [proximity, setProximity] = useState(0) // 0 (centered) .. 1 (at the boundary)
  const [atBoundary, setAtBoundary] = useState(false)

  useEffect(() => {
    if (!open) return
    setPinPos(origin)
    setAddress(originAddress)
    setProximity(0)
    setAtBoundary(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleDrag = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return
    const dist = haversineMetres(origin, [e.latLng.lat(), e.latLng.lng()])
    setProximity(Math.min(1, dist / PICKUP_EDIT_RADIUS_METRES))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originLat, originLng])

  const handleDragEnd = useCallback((e: google.maps.MapMouseEvent) => {
    if (!e.latLng) return
    const dropped = [e.latLng.lat(), e.latLng.lng()] as [number, number]
    const clamped = clampToRadius(origin, dropped, PICKUP_EDIT_RADIUS_METRES)
    const wasClamped = clamped[0] !== dropped[0] || clamped[1] !== dropped[1]
    setPinPos(clamped)
    setProximity(wasClamped ? 1 : haversineMetres(origin, clamped) / PICKUP_EDIT_RADIUS_METRES)
    setAtBoundary(wasClamped)
    if (wasClamped) setTimeout(() => setAtBoundary(false), 2000)

    setGeocoding(true)
    geoApi.reverseGeocode(clamped[0], clamped[1])
      .then(setAddress)
      .catch(() => {})
      .finally(() => setGeocoding(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originLat, originLng])

  const distanceToUser = userPos ? Math.round(haversineMetres(userPos, pinPos)) : null
  const edgeColor = proximity >= 0.85 ? '#F59E0B' : '#0A9FB0'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="edit-pickup-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Edit pickup location"
          className="fixed inset-0 z-50 bg-background flex flex-col"
          initial={reduce ? { opacity: 0 } : { y: '100%' }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: '100%' }}
          transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 340, damping: 34 }}
        >
          {/* ── Map ── */}
          <div className="relative flex-1 min-h-0">
            <MapViewInner center={origin} zoom={EDIT_ZOOM}>
              {/* Soft ambient boundary feedback — no drawn ring at rest; the
                  tight zoom itself communicates the allowed area (see
                  docs/designs/2026-09-27-pickup-pin-edit-plan.md, D1/D4). */}
              <Circle
                center={{ lat: originLat, lng: originLng }}
                radius={PICKUP_EDIT_RADIUS_METRES}
                fillColor={edgeColor}
                fillOpacity={proximity * proximity * 0.22}
                strokeColor={edgeColor}
                strokeOpacity={proximity * proximity * 0.35}
                strokeWeight={2}
                clickable={false}
              />

              {userPos && (
                <>
                  <Polyline
                    path={[{ lat: userPos[0], lng: userPos[1] }, { lat: pinPos[0], lng: pinPos[1] }]}
                    strokeColor="#0A9FB0"
                    strokeOpacity={0}
                    icons={[{
                      icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.6, scale: 3 },
                      offset: '0', repeat: '12px',
                    }]}
                  />
                  <AdvancedMarker position={{ lat: userPos[0], lng: userPos[1] }}>
                    <div className="relative w-4 h-4">
                      <div className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
                      <div className="relative w-4 h-4 rounded-full bg-primary border-2 border-white shadow" />
                    </div>
                  </AdvancedMarker>
                </>
              )}

              <AdvancedMarker
                position={{ lat: pinPos[0], lng: pinPos[1] }}
                draggable
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
              >
                <div style={{ marginBottom: -8 }}>
                  <svg width="30" height="46" viewBox="0 0 30 46" style={{ filter: 'drop-shadow(0 6px 12px rgba(10,159,176,0.5))' }}>
                    <defs>
                      <linearGradient id="editPinGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#0A9FB0" />
                        <stop offset="100%" stopColor="#22B8C9" />
                      </linearGradient>
                    </defs>
                    <path d="M15 0C6.7 0 0 6.7 0 15c0 11 15 31 15 31s15-20 15-31C30 6.7 23.3 0 15 0z" fill="url(#editPinGrad)" stroke="#FFFFFF" strokeWidth="1.6" />
                    <circle cx="15" cy="15" r="4.5" fill="#FFFFFF" />
                  </svg>
                </div>
              </AdvancedMarker>
            </MapViewInner>

            {/* Header */}
            <div className="absolute top-0 left-0 right-0 px-4 pt-safe-top" style={{ zIndex: 20 }}>
              <div className="flex items-center gap-3 pt-3">
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="w-11 h-11 rounded-full bg-surface shadow-card flex items-center justify-center active:scale-90 transition-transform"
                >
                  <ArrowLeft size={18} className="text-text-primary" strokeWidth={2} />
                </button>
                <div className="bg-surface rounded-full shadow-card px-4 py-2">
                  <p className="text-sm font-semibold text-text-primary">Edit pickup</p>
                </div>
              </div>
            </div>

            {atBoundary && (
              <div className="absolute top-24 left-0 right-0 flex justify-center" style={{ zIndex: 20 }}>
                <div className="bg-status-warning/15 text-status-warning text-xs font-semibold px-3.5 py-1.5 rounded-full shadow-card">
                  Pickup can only move within this zone
                </div>
              </div>
            )}
          </div>

          {/* ── Confirm sheet ── */}
          <div className="bg-surface rounded-t-3xl shadow-sheet px-5 pt-5 pb-8 flex-shrink-0">
            <div className="w-9 h-1 bg-primary/15 rounded-full mx-auto mb-4" />

            <p className="font-display text-lg font-bold text-text-primary mb-1">
              Confirm your pickup point
            </p>

            <div className="flex items-start gap-3 mb-1">
              <div className="w-8 h-8 rounded-xl bg-primary-subtle flex items-center justify-center flex-shrink-0 mt-0.5">
                {geocoding
                  ? <OcarSpinner size={14} variant="color" />
                  : <MapPin size={14} className="text-primary" strokeWidth={1.8} />
                }
              </div>
              <div className="flex-1 min-w-0">
                {!address ? (
                  <div className="h-4 w-40 bg-surface-2 rounded animate-pulse" />
                ) : (
                  <p className="text-sm font-semibold text-text-primary leading-snug">{address}</p>
                )}
              </div>
            </div>
            <p className="text-xs text-text-muted mb-4 pl-11">
              {distanceToUser != null ? `${distanceToUser} m from your live location · ` : ''}
              drag the pin to fine-tune.
            </p>

            {driverAssigned && (
              <p className="text-xs text-text-muted mb-3 pl-1">Your driver will be notified of the update.</p>
            )}

            {error && (
              <p className="text-xs font-medium text-status-error mb-3 pl-1">{error}</p>
            )}

            <button
              onClick={() => onConfirm({ lat: pinPos[0], lng: pinPos[1], address })}
              disabled={!address || confirming || geocoding}
              className="btn-primary w-full"
            >
              {confirming ? (
                <span className="flex items-center justify-center gap-2">
                  <OcarSpinner size={16} variant="white" /> Updating pickup…
                </span>
              ) : 'Confirm pickup'}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
