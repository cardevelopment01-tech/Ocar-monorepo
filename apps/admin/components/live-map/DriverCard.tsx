'use client'

import Link from 'next/link'
import { ArrowUpRight, Crosshair, Phone, X } from 'lucide-react'
import type { ActiveDriverSession } from '@/lib/admin-api'
import { STAGE_META, stageOf } from '@/lib/live-map-model'
import { isStale } from '@/lib/driver-staleness'
import { ago } from '@/lib/ride-situation'
import { initials } from './DriverList'
import { cn } from '@/lib/utils'

// The card for a selected driver: who, where they are in the trip, the vehicle, whether the position is live, and the three things ops does next.
export function DriverCard({ driver, nowMs, following, onFollow, onClose }: { driver: ActiveDriverSession; nowMs: number; following: boolean; onFollow: () => void; onClose: () => void }) {
  const stage = stageOf(driver, nowMs)
  const meta = STAGE_META[stage]
  const stale = isStale(driver.location_updated_at, nowMs)
  const vehicle = [driver.vehicle_category, driver.vehicle_name].filter(Boolean).join(' · ')
  return (
    <div className="absolute bottom-4 left-4 z-[1000] w-80 overflow-hidden rounded-2xl border border-white/70 bg-white/95 shadow-xl shadow-slate-900/15 ring-1 ring-slate-900/5 backdrop-blur-md" role="dialog" aria-label={driver.driver_name ?? 'Driver'}>
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: meta.color }} aria-hidden>{initials(driver.driver_name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold text-text-primary">{driver.driver_name ?? 'Driver'}</p>
          <p className="truncate text-xs text-text-muted">{driver.driver_code} · {driver.driver_phone}</p>
          <span className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-text-secondary">
            <span className="h-2 w-2 rounded-full" style={{ background: meta.color }} aria-hidden />
            {meta.label}
          </span>
        </div>
        <button onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-primary"><X size={16} aria-hidden /></button>
      </div>

      <div className="space-y-2.5 border-t border-border-light px-4 py-3 text-xs text-text-secondary">
        <p>
          {vehicle || 'No vehicle on file'}
          {driver.number_plate ? <span className="ml-2 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-text-primary">{driver.number_plate}</span> : null}
          {driver.city_name ? <span className="ml-2 text-text-muted">{driver.city_name}</span> : null}
        </p>

        {driver.ride_id && (
          <div className="space-y-1.5">
            {driver.rider_name && <p className="truncate"><span className="mr-1.5 text-text-muted">Rider</span><span className="font-medium text-text-primary">{driver.rider_name}</span></p>}
            <div className="relative space-y-1.5 pl-4">
              <span className="absolute bottom-2 left-[3px] top-2 w-px bg-border" aria-hidden />
              <p className="relative truncate"><span className="absolute -left-4 top-1.5 h-[7px] w-[7px] rounded-full bg-success" aria-hidden />{driver.origin_address ?? '—'}</p>
              <p className="relative truncate"><span className="absolute -left-4 top-1.5 h-[7px] w-[7px] rounded-full bg-danger" aria-hidden />{driver.destination_address ?? '—'}</p>
            </div>
          </div>
        )}

        {driver.lat != null && (
          <p className={cn('flex flex-wrap items-center gap-x-1.5', stale ? 'font-semibold text-danger' : 'text-text-muted')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', stale ? 'bg-danger' : 'animate-pulse bg-success')} aria-hidden />
            {stale ? `Last seen ${ago(driver.location_updated_at, nowMs) || 'a long time ago'}, not live` : 'Live'}
            <span className="font-normal text-text-muted">· {driver.lat.toFixed(5)}, {driver.lng?.toFixed(5)}{driver.speed_kmph != null ? ` · ${driver.speed_kmph} km/h` : ''}</span>
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-border-light p-3">
        <a href={`tel:${driver.driver_phone}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white hover:bg-primary-dark">
          <Phone size={13} aria-hidden /> Call driver
        </a>
        {driver.ride_id && (
          <Link href={`/rides/${driver.ride_id}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-primary hover:bg-surface-2">
            Open ride <ArrowUpRight size={13} aria-hidden />
          </Link>
        )}
        {driver.lat != null && (
          <button type="button" onClick={onFollow} aria-pressed={following} className={cn('flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold', following ? 'border-primary bg-primary text-white' : 'border-border text-primary hover:bg-surface-2')}>
            <Crosshair size={13} aria-hidden /> {following ? 'Following' : 'Follow'}
          </button>
        )}
      </div>
    </div>
  )
}
