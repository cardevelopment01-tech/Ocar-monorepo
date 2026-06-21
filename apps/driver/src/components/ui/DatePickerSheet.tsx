import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, X } from 'lucide-react'

export interface DatePickerSheetProps {
  label: string
  value: string                  // 'YYYY-MM-DD' | ''
  onChange: (v: string) => void
  minDate?: string               // 'YYYY-MM-DD'
  maxDate?: string
  placeholder?: string
  disabled?: boolean
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const ITEM_H      = 48
const VISIBLE     = 5
const DRUM_H      = ITEM_H * VISIBLE   // 240px
const SPACER      = ITEM_H * 2         // 96px — 2 items above/below center

// ── helpers ──────────────────────────────────────────────────────────────────

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate()
}

function parseISO(s?: string) {
  if (!s || s.length < 10) return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m || !d) return null
  return { y, m, d }
}

function toDisplay(iso: string) {
  const p = parseISO(iso)
  if (!p) return ''
  return new Date(p.y, p.m - 1, p.d).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ── Drum column (defined outside parent to preserve DOM on re-renders) ────────

interface DrumProps {
  items: number[]
  format: (n: number) => string
  scrollRef: React.RefObject<HTMLDivElement | null>
  onScroll: () => void
}

function Drum({ items, format, scrollRef, onScroll }: DrumProps) {
  return (
    <div className="relative flex-1 overflow-hidden" style={{ height: DRUM_H }}>
      {/* Center-row highlight band */}
      <div
        className="absolute left-1 right-1 rounded-xl pointer-events-none"
        style={{
          top: SPACER, height: ITEM_H, zIndex: 2,
          background: 'rgba(37,99,235,0.09)',
          border: '1.5px solid rgba(37,99,235,0.16)',
        }}
      />
      {/* Top fade */}
      <div
        className="absolute inset-x-0 top-0 pointer-events-none"
        style={{ height: SPACER, zIndex: 2, background: 'linear-gradient(to bottom, #fff 40%, transparent)' }}
      />
      {/* Bottom fade */}
      <div
        className="absolute inset-x-0 bottom-0 pointer-events-none"
        style={{ height: SPACER, zIndex: 2, background: 'linear-gradient(to top, #fff 40%, transparent)' }}
      />
      {/* Scrollable column */}
      <div
        ref={scrollRef}
        className="absolute inset-0 overflow-y-scroll overscroll-contain date-drum"
        style={{ scrollSnapType: 'y mandatory' }}
        onScroll={onScroll}
      >
        <div style={{ height: SPACER }} aria-hidden="true" />
        {items.map(item => (
          <div
            key={item}
            className="flex items-center justify-center select-none"
            style={{ height: ITEM_H, scrollSnapAlign: 'center' }}
          >
            <span className="text-[16px] font-semibold text-slate-700">{format(item)}</span>
          </div>
        ))}
        <div style={{ height: SPACER }} aria-hidden="true" />
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DatePickerSheet({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = 'Select date',
  disabled = false,
}: DatePickerSheetProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dayRef     = useRef<HTMLDivElement>(null)
  const monthRef   = useRef<HTMLDivElement>(null)
  const yearRef    = useRef<HTMLDivElement>(null)
  const dayTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const monthTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const yearTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didInit    = useRef(false)

  const now  = new Date()
  const minP = parseISO(minDate)
  const maxP = parseISO(maxDate)
  const minY = minP?.y ?? (now.getFullYear() - 70)
  const maxY = maxP?.y ?? (now.getFullYear() + 15)

  const [draft, setDraft] = useState(() => {
    const p = parseISO(value)
    if (p) return { year: p.y, month: p.m, day: p.d }
    if (minP) return { year: minP.y, month: minP.m, day: minP.d }
    if (maxP) return { year: maxP.y, month: maxP.m, day: maxP.d }
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }
  })

  // ── Computed option arrays ─────────────────────────────────────────────────

  const years: number[] = []
  for (let y = minY; y <= maxY; y++) years.push(y)

  const months: number[] = []
  for (let m = 1; m <= 12; m++) {
    if (minP && draft.year === minP.y && m < minP.m) continue
    if (maxP && draft.year === maxP.y && m > maxP.m) continue
    months.push(m)
  }

  const days: number[] = []
  const maxDay = daysInMonth(draft.year, draft.month)
  for (let d = 1; d <= maxDay; d++) {
    if (minP && draft.year === minP.y && draft.month === minP.m && d < minP.d) continue
    if (maxP && draft.year === maxP.y && draft.month === maxP.m && d > maxP.d) continue
    days.push(d)
  }

  // ── Clamp month when year changes ─────────────────────────────────────────

  useEffect(() => {
    if (!months.includes(draft.month)) {
      const clamped = months[months.length - 1] ?? 1
      setDraft(prev => ({ ...prev, month: clamped }))
      const idx = months.findIndex(m => m === clamped)
      if (idx >= 0 && monthRef.current) monthRef.current.scrollTop = idx * ITEM_H
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.year])

  // ── Clamp day when month/year changes ────────────────────────────────────

  useEffect(() => {
    if (!days.includes(draft.day)) {
      const clamped = days[days.length - 1] ?? 1
      setDraft(prev => ({ ...prev, day: clamped }))
      const idx = days.findIndex(d => d === clamped)
      if (idx >= 0 && dayRef.current) dayRef.current.scrollTop = idx * ITEM_H
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.year, draft.month])

  // ── Sync scroll positions on open ────────────────────────────────────────

  useEffect(() => {
    if (!open) { didInit.current = false; return }
    if (didInit.current) return
    didInit.current = true
    // Re-sync draft from current value (user may have cancelled previously)
    const p = parseISO(value)
    const targetYear  = p?.y   ?? draft.year
    const targetMonth = p?.m   ?? draft.month
    const targetDay   = p?.d   ?? draft.day
    if (p) setDraft({ year: p.y, month: p.m, day: p.d })
    setTimeout(() => {
      const yIdx = years.indexOf(targetYear)
      const mIdx = months.indexOf(targetMonth)
      const dIdx = days.indexOf(targetDay)
      if (yearRef.current  && yIdx >= 0) yearRef.current.scrollTop  = yIdx * ITEM_H
      if (monthRef.current && mIdx >= 0) monthRef.current.scrollTop = mIdx * ITEM_H
      if (dayRef.current   && dIdx >= 0) dayRef.current.scrollTop   = dIdx * ITEM_H
    }, 80)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Body scroll lock + Escape ────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ── Scroll handler factory ────────────────────────────────────────────────

  function makeHandler(
    ref: React.RefObject<HTMLDivElement | null>,
    arr: number[],
    timerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>,
    field: 'day' | 'month' | 'year',
  ) {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const el = ref.current
        if (!el || !arr.length) return
        const idx = Math.max(0, Math.min(arr.length - 1, Math.round(el.scrollTop / ITEM_H)))
        const val = arr[idx]
        if (val === undefined) return
        setDraft(prev => ({ ...prev, [field]: val }))
        el.scrollTop = idx * ITEM_H
      }, 120)
    }
  }

  function handleClose() {
    setOpen(false)
    setTimeout(() => triggerRef.current?.focus(), 50)
  }

  function handleDone() {
    const m = String(draft.month).padStart(2, '0')
    const d = String(draft.day).padStart(2, '0')
    onChange(`${draft.year}-${m}-${d}`)
    handleClose()
  }

  const draftISO = `${draft.year}-${String(draft.month).padStart(2,'0')}-${String(draft.day).padStart(2,'0')}`

  return (
    <>
      {/* Trigger — same height/style as other inputs */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setOpen(true)}
        disabled={disabled}
        className="input-dark w-full flex items-center justify-between gap-2 text-left disabled:opacity-40"
        style={{ minHeight: 52 }}
      >
        <span className={value ? 'text-text-primary font-medium' : 'text-text-muted font-normal'}>
          {value ? toDisplay(value) : placeholder}
        </span>
        <Calendar size={16} className="text-text-muted flex-shrink-0" strokeWidth={1.8} />
      </button>

      {/* Portal sheet */}
      {open && createPortal(
        <div className="fixed inset-0" style={{ zIndex: 60 }}>
          {/* Scrim */}
          <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

          {/* Sheet */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="absolute bottom-0 inset-x-0 bg-white rounded-t-3xl"
            style={{ boxShadow: '0 -4px 40px rgba(0,0,0,0.14)', animation: 'slideUpSheet 220ms cubic-bezier(0.22,1,0.36,1) both' }}
          >
            {/* Handle + header */}
            <div className="px-5 pt-3 pb-3">
              <div className="w-9 h-1 bg-slate-200 rounded-full mx-auto mb-4" />
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-bold text-slate-800">{label}</p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100"
                  aria-label="Close"
                >
                  <X size={15} className="text-slate-500" />
                </button>
              </div>
            </div>

            {/* Column labels */}
            <div className="flex px-5 mb-1">
              {['Day', 'Month', 'Year'].map(col => (
                <p key={col} className="flex-1 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {col}
                </p>
              ))}
            </div>

            {/* Drum columns */}
            <div className="flex items-stretch gap-1 px-4">
              <Drum
                items={days}
                format={n => String(n).padStart(2, '0')}
                scrollRef={dayRef}
                onScroll={makeHandler(dayRef, days, dayTimer, 'day')}
              />
              <div className="w-px bg-slate-100 self-stretch my-3" />
              <Drum
                items={months}
                format={n => MONTHS[n - 1] ?? ''}
                scrollRef={monthRef}
                onScroll={makeHandler(monthRef, months, monthTimer, 'month')}
              />
              <div className="w-px bg-slate-100 self-stretch my-3" />
              <Drum
                items={years}
                format={n => String(n)}
                scrollRef={yearRef}
                onScroll={makeHandler(yearRef, years, yearTimer, 'year')}
              />
            </div>

            {/* Live preview */}
            <div className="mx-5 mt-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100 flex justify-center">
              <p className="text-sm font-semibold text-slate-700">{toDisplay(draftISO)}</p>
            </div>

            {/* Confirm */}
            <div className="px-5 pt-3" style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
              <button
                type="button"
                onClick={handleDone}
                className="btn-go w-full"
                style={{ minHeight: 52 }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <style>{`
        @keyframes slideUpSheet { from { transform: translateY(100%) } to { transform: translateY(0) } }
        .date-drum::-webkit-scrollbar { display: none; }
      `}</style>
    </>
  )
}
