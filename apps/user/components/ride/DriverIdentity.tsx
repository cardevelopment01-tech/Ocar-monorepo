'use client'

import type { ReactNode } from 'react'
import { MessageCircle, Phone, ShieldCheck, Star, MapPin, Navigation } from 'lucide-react'
import { driverIdentity, type DriverIdentityView } from '@ocar/shared'
import type { RideDetail } from '@/lib/ride-api'

// Every place a rider sees their driver (live ride, chat, rate, receipt, history) renders through
// this file, so the identity reads identically everywhere: photo + rating chip, name, trips,
// verified, "Colour Brand Model", number plate. Facts/rules live in @ocar/shared and are shared
// with the rider mobile app.

export function driverViewFromRide(ride: RideDetail | null): DriverIdentityView {
  return driverIdentity({
    name: ride?.driver_name ?? null,
    rating: ride?.driver_rating ?? null,
    totalTrips: ride?.driver_total_trips ?? null,
    verified: ride?.driver_verified ?? null,
    vehicleColor: ride?.vehicle_color ?? null,
    vehicleBrand: ride?.vehicle_brand ?? null,
    vehicleModel: ride?.vehicle_model ?? null,
    vehicleName: ride?.vehicle_name ?? null,
    plate: ride?.vehicle_number_plate ?? null,
  })
}

const AVATAR_SIZE = { lg: 'w-16 h-16 rounded-2xl text-lg', md: 'w-11 h-11 rounded-xl text-sm', sm: 'w-8 h-8 rounded-lg text-[11px]' } as const

export function DriverAvatar({ view, photo, size = 'md', chip = false }: {
  view: DriverIdentityView; photo: string | null; size?: keyof typeof AVATAR_SIZE; chip?: boolean
}) {
  return (
    <div className="relative flex-shrink-0">
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL, size known
        <img
          src={photo}
          alt={view.name}
          className={`${AVATAR_SIZE[size]} object-cover ring-2 ring-white shadow-sm`}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <div className={`${AVATAR_SIZE[size]} flex items-center justify-center text-white font-bold bg-gradient-primary`}>{view.initials}</div>
      )}
      {chip && (
        <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white border border-border shadow-sm text-[11px] font-bold text-text-primary whitespace-nowrap">
          {view.ratingText ? <><Star size={10} className="fill-amber-400 text-amber-400" />{view.ratingText}</> : 'New'}
        </span>
      )}
    </div>
  )
}

export function PlateBadge({ plate }: { plate: string | null }) {
  if (!plate) return null
  return (
    <span aria-label={`Number plate ${plate}`} className="flex-shrink-0 px-2.5 py-1 rounded-lg border-2 border-text-primary bg-white text-[13px] font-extrabold tracking-[0.12em] text-text-primary whitespace-nowrap">
      {plate}
    </span>
  )
}

export function VehicleLine({ view }: { view: DriverIdentityView }) {
  return (
    <p className="flex items-center gap-1.5 min-w-0 text-sm font-semibold text-text-primary">
      {view.swatch && <span aria-hidden className="w-3.5 h-3.5 rounded-full border border-black/35 flex-shrink-0" style={{ backgroundColor: view.swatch }} />}
      <span className="truncate">{view.vehicleLine}</span>
    </p>
  )
}

// Compact identity line for chat header / receipt / rate: avatar, name, "★ 4.9 · 1,240 trips",
// vehicle + plate. `right` is a slot for screen-specific extras (e.g. a status pill).
export function DriverRow({ view, photo, right }: { view: DriverIdentityView; photo: string | null; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <DriverAvatar view={view} photo={photo} size="md" />
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[15px] leading-tight truncate text-text-primary">{view.name}</p>
        <p className="flex items-center gap-1 text-[12px] text-text-muted mt-0.5 truncate">
          {view.ratingText && <><Star size={11} className="fill-amber-400 text-amber-400 flex-shrink-0" /><span className="font-semibold text-text-secondary">{view.ratingText}</span><span>·</span></>}
          <span className="truncate">{view.tripsText}</span>
        </p>
        <p className="flex items-center gap-1.5 text-[12px] text-text-secondary mt-0.5 min-w-0">
          {view.swatch && <span aria-hidden className="w-2.5 h-2.5 rounded-full border border-black/35 flex-shrink-0" style={{ backgroundColor: view.swatch }} />}
          <span className="truncate">{view.vehicleLine}{view.plate ? ` · ${view.plate}` : ''}</span>
        </p>
      </div>
      {right}
    </div>
  )
}

// Rapido's "Start your order with PIN [9][2][6][5]" / Uber's "Share PIN" band: the one thing a
// rider reads aloud to a stranger at the car window, so it sits above the driver card, big.
export function PinBand({ otp, phase }: { otp: string | null; phase: 'start' | 'end' }) {
  const title = phase === 'start' ? 'Share PIN to start' : 'Share PIN to end'
  const hint = phase === 'start' ? 'Share only once you are in the cab' : 'Share only when you reach your drop'
  return (
    <div className="rounded-2xl px-4 py-3 bg-gradient-primary text-white flex items-center justify-between gap-3" role="group" aria-label={otp ? `${title}: ${otp.split('').join(' ')}` : title}>
      <div className="min-w-0">
        <p className="text-[14px] font-semibold leading-tight">{title}</p>
        <p className="text-[11px] mt-1 opacity-90 leading-snug">{hint}</p>
      </div>
      {otp ? (
        <div className="flex gap-1.5 flex-shrink-0">
          {otp.split('').map((d, i) => (
            <span key={i} className="w-9 h-11 rounded-xl bg-white text-text-primary flex items-center justify-center text-xl font-bold tabular-nums">{d}</span>
          ))}
        </div>
      ) : (
        <span className="text-[12px] font-medium opacity-90">Generating…</span>
      )}
    </div>
  )
}

// Uber/Rapido "Meet at <pickup>" + Get directions.
export function MeetAtRow({ address, lat, lng }: { address: string | null; lat: number | null; lng: number | null }) {
  if (!address) return null
  const href = lat != null && lng != null ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : null
  return (
    <div className="flex items-center gap-3 rounded-2xl px-4 py-2.5 bg-background border border-border">
      <MapPin size={16} className="text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-text-muted">Meet at</p>
        <p className="text-sm font-semibold text-text-primary truncate">{address}</p>
      </div>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[12px] font-semibold text-primary flex-shrink-0">
          <Navigation size={13} /> Directions
        </a>
      )}
    </div>
  )
}

export function DriverCard({ view, photo, canCall, calling, callError, unread, upgradedTo, onCall, onMessage }: {
  view: DriverIdentityView; photo: string | null; canCall: boolean; calling: boolean; callError: string | null
  unread: number; upgradedTo: string | null; onCall: () => void; onMessage: () => void
}) {
  return (
    <div className="rounded-3xl relative bg-background border border-border p-3.5 shadow-sm">
      {callError && (
        <span className="absolute -top-7 right-0 px-2.5 py-1 rounded-lg bg-red-50 text-[11px] font-medium text-red-600 shadow-sm whitespace-nowrap">{callError}</span>
      )}
      <div className="flex items-center gap-3.5">
        <DriverAvatar view={view} photo={photo} size="lg" chip />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base leading-tight line-clamp-2 break-words text-text-primary">{view.name}</p>
          <p className="text-[12px] text-text-muted mt-0.5">{view.tripsText}</p>
          {view.verified && (
            <p className="flex items-center gap-1 text-[11px] font-medium text-status-success mt-1"><ShieldCheck size={12} /> Verified driver</p>
          )}
        </div>
      </div>

      <div className="mt-3.5 pt-2.5 border-t border-border flex items-center justify-between gap-3">
        <div className="min-w-0">
          <VehicleLine view={view} />
          {upgradedTo && (
            <span className="inline-block mt-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-money-light text-money">Upgraded to {upgradedTo}</span>
          )}
        </div>
        <PlateBadge plate={view.plate} />
      </div>

      {/* Uber: "Send a message" + phone. The rider never sees the driver's raw number (masking is
          server-side), so Call triggers an Exotel-bridged call, gated on canCall. */}
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onMessage}
          className="relative flex-1 h-11 rounded-full flex items-center justify-center gap-2 text-sm font-semibold text-text-primary bg-primary-subtle active:scale-[0.98] transition-transform"
        >
          <MessageCircle size={16} className="text-primary" />
          Message {view.firstName}
          {unread > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-red-600">{unread > 9 ? '9+' : unread}</span>
          )}
        </button>
        {canCall && (
          <button
            onClick={onCall}
            disabled={calling}
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 bg-primary-subtle active:scale-95 transition-transform disabled:opacity-50"
            aria-label="Call driver"
          >
            <Phone size={16} className="text-primary" />
          </button>
        )}
      </div>
    </div>
  )
}

// History rows only know the driver's name; same avatar treatment, no vehicle facts.
export function driverViewFromName(name: string | null): DriverIdentityView {
  return driverIdentity({ name, rating: null, totalTrips: null, verified: null, vehicleColor: null, vehicleBrand: null, vehicleModel: null, vehicleName: null, plate: null })
}
