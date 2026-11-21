'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock, PlusCircle } from 'lucide-react'
import { serverNow } from '@/lib/serverClock'
import { pickupWait, pickupWaitCopy, type PickupWaitState } from '@/lib/pickupWait'

const TICK_MS = 1000
// The clock starts on the server once the driver's position reaches the pickup, which the page only learns by asking again.
const REFRESH_MS = 15_000

type Props = {
  status: string | null | undefined
  /** When the wait started; absent until the driver is really at the pickup. */
  startedAt: string | null | undefined
  freeMin: number | null | undefined
  perMin: string | number | null | undefined
  /** Called every 15 s while the driver has tapped arrived but the clock has not started. */
  onNeedRefresh?: () => void
}

const ICONS = { clock: Clock, 'plus-circle': PlusCircle } as const

// The rider's waiting clock at the pickup: a free-minutes countdown, then extra waiting counting up with the fixed rate underneath.
// Same quiet card as the booked-time clock (icon and words in every state); once the free minutes run out it takes a soft amber tint and
// an accent edge. It never shows a running amount: the charge is added to the final fare and shown on the receipt. Renders nothing until
// the driver is really at the pickup.
export default function PickupWaitClock({ status, startedAt, freeMin, perMin, onNeedRefresh }: Props) {
  const compute = () => pickupWait({ status, startedAt, freeMin, now: serverNow() })
  const [state, setState] = useState<PickupWaitState>(compute)
  const refreshRef = useRef(onNeedRefresh)
  refreshRef.current = onNeedRefresh

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let refresher: ReturnType<typeof setInterval> | undefined
    const tick = () => {
      const next = compute()
      setState(next)
      if (next.kind === 'free' || next.kind === 'charging') timer = setTimeout(tick, TICK_MS)
    }
    tick()
    if (status === 'driver_arrived' && !startedAt && freeMin != null) {
      refresher = setInterval(() => refreshRef.current?.(), REFRESH_MS)
    }
    return () => { clearTimeout(timer); clearInterval(refresher) }
    // compute closes over exactly these three values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, startedAt, freeMin])

  const rate = perMin == null ? null : Number(perMin)
  const copy = pickupWaitCopy(state, 'rider', { perMin: rate })

  // Polite live region fed only when the free minutes run out, so a screen reader is not read every second.
  const lastKind = useRef<PickupWaitState['kind']>(state.kind)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    if (state.kind !== lastKind.current && state.kind === 'charging' && copy) setAnnouncement(copy.a11y)
    lastKind.current = state.kind
  }, [state.kind, copy])

  if (!copy || copy.icon === 'map-pin') return null
  const Icon = ICONS[copy.icon]
  const caution = copy.tone === 'caution'
  return (
    <>
      <div
        key={state.kind}
        role="timer"
        aria-label={copy.a11y}
        className={`flex overflow-hidden rounded-lg border min-h-[56px] animate-fade-in motion-reduce:animate-none ${
          caution ? 'border-status-warning/40 bg-status-warning/10' : 'border-border bg-surface'
        }`}
      >
        <div className={`w-1 flex-shrink-0 ${caution ? 'bg-status-warning' : 'bg-border'}`} aria-hidden />
        <div className="flex-1 min-w-0 px-3 py-2 flex flex-col justify-center">
          <div className="flex items-center gap-2">
            <Icon size={18} className={`flex-shrink-0 ${caution ? 'text-text-primary' : 'text-text-secondary'}`} aria-hidden />
            {/* Wraps instead of truncating: at large text the value drops under its label. */}
            <div className="flex-1 min-w-0 flex flex-wrap items-baseline justify-between gap-x-2">
              <span className="text-[13px] font-semibold text-text-secondary">{copy.label}</span>
              {copy.value && <span className="text-[20px] font-bold tabular-nums text-text-primary">{copy.value}</span>}
            </div>
          </div>
          {copy.note && <p className="text-xs text-text-secondary pl-[26px]">{copy.note}</p>}
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </>
  )
}
