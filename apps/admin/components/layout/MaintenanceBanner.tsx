'use client'

import { useEffect, useState } from 'react'
import { getMaintenanceState, subscribeMaintenance, type MaintenanceState } from '@/lib/maintenance-store'

// Deliberately a banner, not a full-page block like apps/user and
// apps/driver — the admin app is how maintenance mode gets turned back OFF
// (via /config/maintenance), so it must never lock itself out. Every other
// admin route still 503s underneath (server-side, see maintenance.middleware.ts),
// this just avoids blanking the whole UI so the toggle stays reachable.
export default function MaintenanceBanner() {
  const [state, setState] = useState<MaintenanceState>({ isUnderMaintenance: false })

  useEffect(() => {
    setState(getMaintenanceState())
    return subscribeMaintenance(setState)
  }, [])

  if (!state.isUnderMaintenance) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-danger text-white text-xs font-semibold text-center py-2 px-4">
      Maintenance mode is ON — all public API traffic is blocked.{' '}
      <a href="/config/maintenance" className="underline">Manage</a>
    </div>
  )
}
