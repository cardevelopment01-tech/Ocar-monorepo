'use client'

import { useEffect, useState } from 'react'
import type { MaintenanceState } from '@/lib/maintenance-store'
import OcarLogoMark from './OcarLogoMark'

export default function MaintenanceScreen({ state }: { state: MaintenanceState }) {
  const [countdown, setCountdown] = useState(state.retryAfterSeconds ?? null)

  useEffect(() => {
    if (countdown === null) return
    if (countdown <= 0) {
      window.location.reload()
      return
    }
    const t = setTimeout(() => setCountdown(c => (c ?? 0) - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-5 px-8 text-center"
      style={{ background: '#0F0D1A' }}
    >
      <OcarLogoMark size="lg" />
      <div className="space-y-2">
        <p className="text-white text-base font-bold">We&apos;ll be right back</p>
        <p className="text-white/60 text-sm">
          {state.message ?? 'Ocar is briefly offline for maintenance.'}
        </p>
        {countdown !== null && (
          <p className="text-white/40 text-xs">Retrying in {countdown}s…</p>
        )}
      </div>
      <button
        onClick={() => window.location.reload()}
        className="mt-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        Try Again
      </button>
    </div>
  )
}
