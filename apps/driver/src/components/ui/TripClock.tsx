import { useEffect, useRef, useState } from 'react'
import { Bell, Clock, PlusCircle } from 'lucide-react'
import { serverNow } from '@/lib/serverClock'
import {
  tripWindow, tripWindowCopy,
  type TripWindowCopy, type TripWindowState,
} from '@/lib/tripWindow'

const FAST_MS = 1000
const SLOW_MS = 30_000
// Moments a screen reader user must hear even though the value is not announced every tick.
const ANNOUNCED: ReadonlyArray<TripWindowState['kind']> = ['final', 'grace', 'overtime']

// Same cadence as driver-mobile's useTripWindow: per-second only where seconds are shown.
function nextDelay(state: TripWindowState): number {
  switch (state.kind) {
    case 'none': return SLOW_MS
    case 'grace':
    case 'overtime': return FAST_MS
    case 'final': return state.msLeft <= 5 * 60_000 ? FAST_MS : Math.min(SLOW_MS, state.msLeft - 5 * 60_000 + 1)
    case 'running': return Math.min(SLOW_MS, Math.max(250, state.msLeft - 15 * 60_000 + 1))
  }
}

const rupees = (n: number) => `₹${Number.isInteger(n) ? n : n.toFixed(2)}`

export function useTripWindow(w: { bookedUntil?: string | undefined; overtimeGraceMin?: number | undefined; overtimeRate?: number | undefined }) {
  const { bookedUntil, overtimeGraceMin: graceMin, overtimeRate: rate } = w
  const compute = () => tripWindow({ bookedUntil, graceMin, overtimeRate: rate, now: serverNow() })
  const [state, setState] = useState<TripWindowState>(compute)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      const next = compute()
      setState(next)
      timer = setTimeout(tick, nextDelay(next))
    }
    tick()
    return () => clearTimeout(timer)
    // compute closes over exactly these three values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookedUntil, graceMin, rate])

  const copy: TripWindowCopy | null = tripWindowCopy(state, 'driver', { overtimeRate: rate ?? null, rupees })
  return { state, copy }
}

const ICONS = { clock: Clock, bell: Bell, 'plus-circle': PlusCircle } as const

// One quiet row under the header: booked time left, then the free grace, then overtime with its live
// amount. Tonal, never red (overtime is billed time, not a fault), icon AND words in every state, and
// no pulse. Reads second, after the destination. Renders nothing for rides without a booked window.
export default function TripClock(props: { bookedUntil?: string | undefined; overtimeGraceMin?: number | undefined; overtimeRate?: number | undefined }) {
  const { state, copy } = useTripWindow(props)
  const lastKind = useRef<TripWindowState['kind']>(state.kind)
  const [announcement, setAnnouncement] = useState('')

  // Polite live region fed only on the three transitions, so the screen reader is not read every tick.
  useEffect(() => {
    if (state.kind !== lastKind.current && ANNOUNCED.includes(state.kind) && copy) setAnnouncement(copy.a11y)
    lastKind.current = state.kind
  }, [state.kind, copy])

  if (!copy) return null
  const warn = copy.tone === 'warning'
  const Icon = ICONS[copy.icon]
  return (
    <>
      <div
        key={state.kind}
        role="timer"
        aria-label={copy.a11y}
        className={`flex items-center gap-2 mb-3 px-3 min-h-[48px] py-1.5 rounded-lg animate-fade-in motion-reduce:animate-none ${warn ? 'bg-accent-amber/10' : 'bg-primary-subtle'}`}
      >
        <Icon size={20} className={`flex-shrink-0 ${warn ? 'text-text-primary' : 'text-primary'}`} aria-hidden />
        {/* Wraps instead of truncating: at large text the value drops under its label. */}
        <div className="flex-1 min-w-0 flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-[13px] font-semibold text-text-secondary">{copy.label}</span>
          <span className="text-[20px] font-bold tabular-nums text-text-primary">{copy.value}</span>
        </div>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    </>
  )
}
