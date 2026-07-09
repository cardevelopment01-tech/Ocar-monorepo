'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Check, X } from 'lucide-react'
import { getQuickPicks, ceil15, type QuickPick } from '@/lib/schedule-quick-picks'
import { formatPickupTime } from '@/lib/format-pickup-time'

interface Props {
  open: boolean
  value: Date | null
  min: Date
  max: Date
  onChange: (date: Date | null) => void
  onClose: () => void
}

function isSameDate(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function dayOnly(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function getDayList(min: Date, max: Date): Date[] {
  const days: Date[] = []
  let d = dayOnly(min)
  const maxDay = dayOnly(max)
  while (d.getTime() <= maxDay.getTime()) {
    days.push(d)
    d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  }
  return days
}

function dayLabel(d: Date, i: number): string {
  if (i === 0) return 'Today'
  if (i === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' })
}

function getSlotsForDay(day: Date, min: Date, max: Date): Date[] {
  const isMinDay = isSameDate(day, min)
  const isMaxDay = isSameDate(day, max)
  const start = isMinDay ? ceil15(min) : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 6, 0)
  const end   = isMaxDay ? max : new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 45)
  const slots: Date[] = []
  for (let t = new Date(start); t.getTime() <= end.getTime(); t = new Date(t.getTime() + 15 * 60_000)) {
    slots.push(new Date(t))
  }
  return slots
}

function fmtSlot(d: Date): string {
  return d.toLocaleString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace('AM', 'am').replace('PM', 'pm')
}

export default function SchedulePickerSheet({ open, value, min, max, onChange, onClose }: Props) {
  const [stage, setStage] = useState<1 | 2>(1)
  const [selectedDay, setSelectedDay] = useState<Date>(() => dayOnly(value ?? min))
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(value)
  const firstOptionRef = useRef<HTMLButtonElement>(null)

  // Resync on the closed→open edge — state otherwise goes stale since the sheet stays mounted.
  useEffect(() => {
    if (open) {
      setStage(1)
      setSelectedDay(dayOnly(value ?? min))
      setSelectedSlot(value)
      requestAnimationFrame(() => firstOptionRef.current?.focus())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const quickPicks = getQuickPicks(min, max)
  const dayList = getDayList(min, max)
  const slots = getSlotsForDay(selectedDay, min, max)

  function pickQuick(pick: QuickPick) {
    onChange(pick.value)
  }

  function confirmSlot() {
    if (selectedSlot) onChange(selectedSlot)
  }

  function isQuickSelected(pick: QuickPick) {
    if (pick.value === null) return value === null
    return value !== null && value.getTime() === pick.value.getTime()
  }

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
            role="dialog"
            aria-modal="true"
            aria-label="Choose pickup time"
            layout
            className="w-full rounded-t-[28px] bg-white overflow-hidden"
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

            <AnimatePresence mode="wait">
              {stage === 1 ? (
                <motion.div
                  key="stage1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 pt-2 pb-3">
                    <div>
                      <p className="text-[15px] font-bold" style={{ color: '#0F172A' }}>Pickup time</p>
                      <p className="text-[11px] font-medium mt-0.5" style={{ color: '#94A3B8' }}>
                        At least 1 hour ahead · up to 7 days
                      </p>
                    </div>
                    <button
                      onClick={onClose}
                      aria-label="Close"
                      className="w-8 h-8 rounded-xl flex items-center justify-center transition-opacity active:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                      style={{ background: '#EEF2FF' }}
                    >
                      <X size={14} style={{ color: '#4F46E5' }} />
                    </button>
                  </div>

                  {/* Quick picks */}
                  <div className="px-5 pb-2 space-y-2">
                    {quickPicks.map((pick, i) => {
                      const selected = isQuickSelected(pick)
                      return (
                        <button
                          key={pick.label + i}
                          ref={i === 0 ? firstOptionRef : undefined}
                          type="button"
                          onClick={() => pickQuick(pick)}
                          className="w-full min-h-12 flex items-center justify-between px-4 rounded-xl text-[14px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                          style={{
                            background: selected ? '#4F46E5' : '#F5F7FF',
                            color: selected ? '#fff' : '#0F172A',
                            border: selected ? '1.5px solid #4F46E5' : '1px solid #E8EEFF',
                          }}
                        >
                          <span>
                            {pick.label}
                            {pick.sub && (
                              <span className="ml-1.5 font-medium opacity-80">({pick.sub})</span>
                            )}
                          </span>
                          {selected && <Check size={16} strokeWidth={2.5} />}
                        </button>
                      )
                    })}
                  </div>

                  <div className="px-5 pt-1 pb-4">
                    <button
                      type="button"
                      onClick={() => setStage(2)}
                      className="w-full min-h-11 text-[13px] font-semibold text-indigo-600 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded-lg"
                    >
                      Choose another time ›
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="stage2"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.16 }}
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 px-5 pt-2 pb-3">
                    <button
                      onClick={() => setStage(1)}
                      aria-label="Back to quick options"
                      className="w-11 h-11 -ml-2 rounded-xl flex items-center justify-center transition-opacity active:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                      style={{ background: '#EEF2FF' }}
                    >
                      <ChevronLeft size={16} style={{ color: '#4F46E5' }} />
                    </button>
                    <p className="text-[15px] font-bold" style={{ color: '#0F172A' }}>Pickup time</p>
                  </div>

                  {/* Day strip */}
                  <div className="flex gap-2 px-5 pb-3 overflow-x-auto [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: 'none' }}>
                    {dayList.map((d, i) => {
                      const selected = isSameDate(d, selectedDay)
                      return (
                        <button
                          key={d.toISOString()}
                          type="button"
                          onClick={() => { setSelectedDay(d); setSelectedSlot(null) }}
                          className="flex-shrink-0 h-10 px-4 rounded-xl text-[13px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                          style={{
                            background: selected ? '#4F46E5' : '#EEF2FF',
                            color: selected ? '#fff' : '#4F46E5',
                          }}
                        >
                          {dayLabel(d, i)}
                        </button>
                      )
                    })}
                  </div>

                  <div className="mx-5 mb-3 h-px" style={{ background: '#E8EEFF' }} />

                  {/* Slot grid */}
                  <div className="px-5 mb-4 grid grid-cols-4 gap-2 overflow-y-auto" style={{ maxHeight: 200 }}>
                    {slots.map(s => {
                      const selected = selectedSlot !== null && s.getTime() === selectedSlot.getTime()
                      return (
                        <button
                          key={s.toISOString()}
                          type="button"
                          onClick={() => setSelectedSlot(s)}
                          className="h-10 rounded-lg text-[13px] font-semibold tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                          style={{
                            background: selected ? '#4F46E5' : '#F5F7FF',
                            color: selected ? '#fff' : '#0F172A',
                            border: selected ? '1.5px solid #4F46E5' : '1px solid #E8EEFF',
                          }}
                        >
                          {fmtSlot(s)}
                        </button>
                      )
                    })}
                  </div>

                  {/* Confirm */}
                  <div className="px-5">
                    <button
                      onClick={confirmSlot}
                      disabled={!selectedSlot}
                      className="w-full py-4 rounded-full text-[15px] font-bold text-white transition-all active:scale-[0.98] disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                      style={{
                        background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                        boxShadow: '0 4px 20px rgba(79,70,229,0.40)',
                        minHeight: 52,
                      }}
                    >
                      {selectedSlot ? `Confirm — ${formatPickupTime(selectedSlot)}` : 'Pick a time'}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
