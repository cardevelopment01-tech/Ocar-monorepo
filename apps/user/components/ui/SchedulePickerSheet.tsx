'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ChevronLeft, Check, X, Zap, Clock, Moon, Sunrise } from 'lucide-react'
import { getQuickPicks, ceil15, type QuickPick } from '@/lib/schedule-quick-picks'
import { formatPickupTime } from '@/lib/format-pickup-time'

const ICON_BG = '#EEF2FF'
const ICON_CLR = '#4F46E5'
const SPRING = { type: 'spring', stiffness: 340, damping: 30 } as const

const QUICK_PICK_ICON: Record<string, typeof Zap> = {
  Now: Zap,
  'In 1 hour': Clock,
  Tonight: Moon,
  Tomorrow: Sunrise,
}

// Wheel geometry — row height drives every scroll-position calculation below.
const ROW_H = 48
const WHEEL_ROWS = 5
const WHEEL_H = ROW_H * WHEEL_ROWS
const WHEEL_PAD = (WHEEL_H - ROW_H) / 2

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

const stageVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 28 : -28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir > 0 ? -16 : 16 }),
}

export default function SchedulePickerSheet({ open, value, min, max, onChange, onClose }: Props) {
  const reduce = useReducedMotion()
  const [stage, setStage] = useState<1 | 2>(1)
  const [direction, setDirection] = useState(1)
  const [selectedDay, setSelectedDay] = useState<Date>(() => dayOnly(value ?? min))
  const [centerIndex, setCenterIndex] = useState(0)
  const firstOptionRef = useRef<HTMLButtonElement>(null)
  const wheelRef = useRef<HTMLDivElement>(null)

  // Resync on the closed→open edge — state otherwise goes stale since the sheet stays mounted.
  useEffect(() => {
    if (open) {
      setStage(1)
      setSelectedDay(dayOnly(value ?? min))
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
  const selectedSlot = slots[centerIndex] ?? null

  // Wheel resets to the value's slot (if it falls on the day now showing) whenever
  // stage 2 mounts or the day changes — instant, since it's establishing position, not a gesture.
  useEffect(() => {
    if (stage !== 2) return
    let idx = 0
    if (value && isSameDate(value, selectedDay)) {
      const found = slots.findIndex(s => s.getTime() === value.getTime())
      if (found >= 0) idx = found
    }
    setCenterIndex(idx)
    requestAnimationFrame(() => wheelRef.current?.scrollTo({ top: idx * ROW_H, behavior: 'auto' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, selectedDay])

  function handleWheelScroll() {
    const el = wheelRef.current
    if (!el) return
    const idx = Math.max(0, Math.min(slots.length - 1, Math.round(el.scrollTop / ROW_H)))
    setCenterIndex(prev => (prev === idx ? prev : idx))
  }

  function jumpToSlot(i: number) {
    wheelRef.current?.scrollTo({ top: i * ROW_H, behavior: reduce ? 'auto' : 'smooth' })
  }

  function goToStage2() { setDirection(1); setStage(2) }
  function goToStage1() { setDirection(-1); setStage(1) }

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

            <AnimatePresence mode="popLayout" custom={direction}>
              {stage === 1 ? (
                <motion.div
                  key="stage1"
                  custom={direction}
                  variants={stageVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={reduce ? { duration: 0 } : SPRING}
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
                      const Icon = QUICK_PICK_ICON[pick.label] ?? Clock
                      return (
                        <button
                          key={pick.label + i}
                          ref={i === 0 ? firstOptionRef : undefined}
                          type="button"
                          onClick={() => pickQuick(pick)}
                          className="w-full min-h-14 flex items-center gap-3 px-3.5 rounded-2xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                          style={{
                            background: selected ? ICON_CLR : '#F8FAFC',
                            border: selected ? `1.5px solid ${ICON_CLR}` : '1px solid #E8EEFF',
                          }}
                        >
                          <span
                            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: selected ? 'rgba(255,255,255,0.18)' : ICON_BG }}
                          >
                            <Icon size={16} strokeWidth={2} color={selected ? '#fff' : ICON_CLR} />
                          </span>
                          <span className="flex-1 text-left min-w-0">
                            <span className="block text-[14px] font-bold" style={{ color: selected ? '#fff' : '#0F172A' }}>
                              {pick.label}
                            </span>
                            {pick.sub && (
                              <span
                                className="block text-[12px] font-medium mt-0.5"
                                style={{ color: selected ? 'rgba(255,255,255,0.75)' : '#94A3B8' }}
                              >
                                {pick.sub}
                              </span>
                            )}
                          </span>
                          {selected && <Check size={18} strokeWidth={2.5} className="text-white flex-shrink-0" />}
                        </button>
                      )
                    })}
                  </div>

                  <div className="px-5 pt-1 pb-4">
                    <button
                      type="button"
                      onClick={goToStage2}
                      className="w-full min-h-11 text-[13px] font-semibold text-indigo-600 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded-lg"
                    >
                      Choose another time ›
                    </button>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="stage2"
                  custom={direction}
                  variants={stageVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={reduce ? { duration: 0 } : SPRING}
                >
                  {/* Header */}
                  <div className="flex items-center gap-2 px-5 pt-2 pb-3">
                    <button
                      onClick={goToStage1}
                      aria-label="Back to quick options"
                      className="w-11 h-11 -ml-2 rounded-xl flex items-center justify-center transition-opacity active:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                      style={{ background: '#EEF2FF' }}
                    >
                      <ChevronLeft size={16} style={{ color: '#4F46E5' }} />
                    </button>
                    <p className="text-[15px] font-bold" style={{ color: '#0F172A' }}>Pickup time</p>
                  </div>

                  {/* Day strip */}
                  <div className="flex gap-2 px-5 pb-3 overflow-x-auto scrollbar-none" style={{ overscrollBehavior: 'contain' }}>
                    {dayList.map((d, i) => {
                      const selected = isSameDate(d, selectedDay)
                      return (
                        <button
                          key={d.toISOString()}
                          type="button"
                          onClick={() => setSelectedDay(d)}
                          className="relative flex-shrink-0 h-10 px-4 rounded-xl text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                          style={{
                            background: selected ? undefined : ICON_BG,
                            border: selected ? 'none' : '1px solid #E8EEFF',
                          }}
                        >
                          {selected && (
                            <motion.span
                              layoutId="day-pill"
                              className="absolute inset-0 rounded-xl"
                              style={{ background: '#4F46E5' }}
                              transition={reduce ? { duration: 0 } : SPRING}
                            />
                          )}
                          <span className="relative" style={{ color: selected ? '#fff' : ICON_CLR }}>
                            {dayLabel(d, i)}
                          </span>
                        </button>
                      )
                    })}
                  </div>

                  <div className="mx-5 mb-1 h-px" style={{ background: '#E8EEFF' }} />

                  {/* Time wheel — native scroll-snap, not a button grid */}
                  <div className="px-5 mb-2">
                    <div className="relative" style={{ height: WHEEL_H }}>
                      {/* Center selection band */}
                      <div
                        className="absolute left-0 right-0 pointer-events-none rounded-2xl"
                        style={{
                          top: '50%', transform: 'translateY(-50%)', height: ROW_H,
                          background: ICON_BG, border: `1.5px solid ${ICON_CLR}40`,
                        }}
                      />
                      <div
                        ref={wheelRef}
                        onScroll={handleWheelScroll}
                        className="h-full overflow-y-auto scrollbar-none"
                        style={{ scrollSnapType: 'y mandatory', overscrollBehavior: 'contain' }}
                      >
                        <div style={{ height: WHEEL_PAD }} />
                        {slots.map((s, i) => {
                          const dist = Math.abs(i - centerIndex)
                          const scale   = dist === 0 ? 1 : dist === 1 ? 0.86 : 0.74
                          const opacity = dist === 0 ? 1 : dist === 1 ? 0.55 : 0.28
                          return (
                            <button
                              key={s.toISOString()}
                              type="button"
                              onClick={() => jumpToSlot(i)}
                              aria-pressed={dist === 0}
                              aria-label={`Select ${fmtSlot(s)}`}
                              className="w-full flex items-center justify-center outline-none"
                              style={{ height: ROW_H, scrollSnapAlign: 'center' }}
                            >
                              <span
                                className={`tabular-nums ${reduce ? '' : 'transition-[opacity,transform] duration-150 ease-out'}`}
                                style={{
                                  opacity,
                                  transform: `scale(${scale})`,
                                  fontWeight: dist === 0 ? 700 : 500,
                                  fontSize: dist === 0 ? 19 : 15,
                                  color: dist === 0 ? ICON_CLR : '#94A3B8',
                                }}
                              >
                                {fmtSlot(s)}
                              </span>
                            </button>
                          )
                        })}
                        <div style={{ height: WHEEL_PAD }} />
                      </div>
                    </div>
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
