'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X } from 'lucide-react'

const DAYS   = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate() }
function firstWeekday(y: number, m: number) { return new Date(y, m, 1).getDay() }

interface Props {
  open: boolean
  value: Date | null
  min?: Date
  onConfirm: (date: Date) => void
  onClose: () => void
}

export default function DateTimePickerSheet({ open, value, min, onConfirm, onClose }: Props) {
  const minDate  = min ?? new Date()
  const initDate = value ?? minDate

  const [viewY,    setViewY]   = useState(initDate.getFullYear())
  const [viewM,    setViewM]   = useState(initDate.getMonth())
  const [selDay,   setSelDay]  = useState<{ y: number; m: number; d: number }>({
    y: initDate.getFullYear(), m: initDate.getMonth(), d: initDate.getDate(),
  })
  const [hour,   setHour]   = useState(initDate.getHours())
  const [minute, setMinute] = useState(Math.round(initDate.getMinutes() / 5) * 5 % 60)

  function prevMonth() {
    if (viewM === 0) { setViewM(11); setViewY(y => y - 1) }
    else setViewM(m => m - 1)
  }
  function nextMonth() {
    if (viewM === 11) { setViewM(0); setViewY(y => y + 1) }
    else setViewM(m => m + 1)
  }

  function isDisabled(y: number, m: number, d: number) {
    const cell = new Date(y, m, d)
    const floor = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate())
    return cell < floor
  }

  function pickDay(d: number) {
    if (isDisabled(viewY, viewM, d)) return
    setSelDay({ y: viewY, m: viewM, d })
  }

  function confirm() {
    onConfirm(new Date(selDay.y, selDay.m, selDay.d, hour, minute))
    onClose()
  }

  // Calendar grid cells
  const total    = daysInMonth(viewY, viewM)
  const offset   = firstWeekday(viewY, viewM)
  const cells: (number | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => i + 1),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const now = new Date()
  const isToday   = (d: number) => viewY === now.getFullYear() && viewM === now.getMonth() && d === now.getDate()
  const isSelected = (d: number) => selDay.y === viewY && selDay.m === viewM && selDay.d === d

  const displayLabel = `${MONTHS[selDay.m].slice(0, 3)} ${selDay.d} · ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end"
          style={{ background: 'rgba(15,23,42,0.55)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full rounded-t-[28px] bg-white"
            style={{
              boxShadow: '0 -8px 40px rgba(79,70,229,0.18)',
              paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
            }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-9 h-[3px] rounded-full" style={{ background: 'rgba(79,70,229,0.15)' }} />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-2 pb-3">
              <div>
                <p className="text-[15px] font-bold" style={{ color: '#0F172A' }}>Return date &amp; time</p>
                <p className="text-[11px] font-medium mt-0.5" style={{ color: '#94A3B8' }}>Minimum 4 hours from now</p>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-opacity active:opacity-60"
                style={{ background: '#EEF2FF' }}
              >
                <X size={14} style={{ color: '#4F46E5' }} />
              </button>
            </div>

            {/* Month navigator */}
            <div className="flex items-center justify-between px-5 pb-2">
              <button
                onClick={prevMonth}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-opacity active:opacity-60"
                style={{ background: '#F5F7FF', border: '1px solid #E8EEFF' }}
              >
                <ChevronLeft size={14} style={{ color: '#4F46E5' }} />
              </button>
              <p className="text-[13px] font-bold" style={{ color: '#0F172A' }}>
                {MONTHS[viewM]} {viewY}
              </p>
              <button
                onClick={nextMonth}
                className="w-8 h-8 rounded-xl flex items-center justify-center transition-opacity active:opacity-60"
                style={{ background: '#F5F7FF', border: '1px solid #E8EEFF' }}
              >
                <ChevronRight size={14} style={{ color: '#4F46E5' }} />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid grid-cols-7 px-4 mb-0.5">
              {DAYS.map(d => (
                <div key={d} className="text-center text-[11px] font-semibold py-1" style={{ color: '#94A3B8' }}>
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 px-4 gap-y-0.5 pb-1">
              {cells.map((d, i) => {
                if (!d) return <div key={`e-${i}`} />
                const disabled = isDisabled(viewY, viewM, d)
                const selected = isSelected(d)
                const today    = isToday(d)
                return (
                  <button
                    key={`d-${d}`}
                    onClick={() => pickDay(d)}
                    disabled={disabled}
                    className="flex items-center justify-center h-9 rounded-full text-[13px] font-semibold transition-all duration-150"
                    style={{
                      background: selected ? '#4F46E5' : today && !selected ? '#EEF2FF' : 'transparent',
                      color: selected ? '#fff' : disabled ? '#CBD5E1' : today ? '#4F46E5' : '#0F172A',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {d}
                  </button>
                )
              })}
            </div>

            {/* Divider */}
            <div className="mx-5 mt-3 mb-3 h-px" style={{ background: '#E8EEFF' }} />

            {/* Time picker */}
            <div className="px-5 mb-4">
              <p className="text-[10px] font-semibold mb-3 tracking-wide" style={{ color: '#94A3B8' }}>RETURN TIME</p>
              <div className="flex items-center gap-3">
                {/* Hour column */}
                <div className="flex-1 flex flex-col items-center gap-1.5">
                  <button
                    onClick={() => setHour(h => (h + 1) % 24)}
                    className="w-10 h-7 rounded-xl flex items-center justify-center transition-opacity active:opacity-60"
                    style={{ background: '#EEF2FF' }}
                  >
                    <ChevronUp size={13} style={{ color: '#4F46E5' }} strokeWidth={2.5} />
                  </button>
                  <div
                    className="w-full rounded-2xl flex items-center justify-center py-2.5"
                    style={{ background: '#EEF2FF', border: '1.5px solid #C7D2FE' }}
                  >
                    <span className="text-[26px] font-black tabular-nums leading-none" style={{ color: '#4F46E5' }}>
                      {String(hour).padStart(2, '0')}
                    </span>
                  </div>
                  <button
                    onClick={() => setHour(h => (h + 23) % 24)}
                    className="w-10 h-7 rounded-xl flex items-center justify-center transition-opacity active:opacity-60"
                    style={{ background: '#EEF2FF' }}
                  >
                    <ChevronDown size={13} style={{ color: '#4F46E5' }} strokeWidth={2.5} />
                  </button>
                  <p className="text-[10px] font-semibold tracking-wide" style={{ color: '#94A3B8' }}>HOUR</p>
                </div>

                <span className="text-[28px] font-black pb-5" style={{ color: '#C7D2FE' }}>:</span>

                {/* Minute column */}
                <div className="flex-1 flex flex-col items-center gap-1.5">
                  <button
                    onClick={() => setMinute(m => (m + 5) % 60)}
                    className="w-10 h-7 rounded-xl flex items-center justify-center transition-opacity active:opacity-60"
                    style={{ background: '#EEF2FF' }}
                  >
                    <ChevronUp size={13} style={{ color: '#4F46E5' }} strokeWidth={2.5} />
                  </button>
                  <div
                    className="w-full rounded-2xl flex items-center justify-center py-2.5"
                    style={{ background: '#EEF2FF', border: '1.5px solid #C7D2FE' }}
                  >
                    <span className="text-[26px] font-black tabular-nums leading-none" style={{ color: '#4F46E5' }}>
                      {String(minute).padStart(2, '0')}
                    </span>
                  </div>
                  <button
                    onClick={() => setMinute(m => (m - 5 + 60) % 60)}
                    className="w-10 h-7 rounded-xl flex items-center justify-center transition-opacity active:opacity-60"
                    style={{ background: '#EEF2FF' }}
                  >
                    <ChevronDown size={13} style={{ color: '#4F46E5' }} strokeWidth={2.5} />
                  </button>
                  <p className="text-[10px] font-semibold tracking-wide" style={{ color: '#94A3B8' }}>MIN</p>
                </div>
              </div>
            </div>

            {/* Confirm */}
            <div className="px-5">
              <button
                onClick={confirm}
                className="w-full py-4 rounded-full text-[15px] font-bold text-white transition-all active:scale-[0.98]"
                style={{
                  background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                  boxShadow: '0 4px 20px rgba(79,70,229,0.40)',
                  minHeight: 52,
                }}
              >
                Confirm — {displayLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
