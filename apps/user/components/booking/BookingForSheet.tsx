'use client'

import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { User, UserPlus, ChevronLeft } from 'lucide-react'

const EASE = [0.22, 1, 0.36, 1] as const

type Props = {
  open: boolean
  onClose: () => void
  riderName: string
  riderPhone: string
  onCommit: (name: string, phone: string) => void
  onClearToMyself: () => void
}

export default function BookingForSheet({ open, onClose, riderName, riderPhone, onCommit, onClearToMyself }: Props) {
  const reduce = useReducedMotion()
  const [view, setView] = useState<'select' | 'form'>('select')
  const [direction, setDirection] = useState<1 | -1>(1)
  const [nameDraft, setNameDraft] = useState('')
  const [phoneDraft, setPhoneDraft] = useState('')
  const bookingForOther = riderName !== '' && riderPhone !== ''

  function goToForm() { setDirection(1); setView('form') }
  function goToSelect() { setDirection(-1); setView('select') }

  // Materialize recipe already established in this app (see home/page.tsx) — reused
  // here rather than inventing a new motion language for one component.
  function enterRow(delay: number) {
    return {
      initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8, filter: 'blur(4px)' },
      animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
      transition: { delay, duration: 0.32, ease: EASE },
    }
  }

  return (
    <AnimatePresence onExitComplete={() => setView('select')}>
      {open && (
        <>
          <motion.div
            key="forme-backdrop"
            className="absolute inset-0 z-40"
            style={{ background: 'rgba(15,23,42,0.48)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.01 : 0.2 }}
            onClick={onClose}
          />
          <motion.div
            key="forme-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Choose who's travelling"
            className="absolute bottom-0 left-0 right-0 z-50 bg-white overflow-hidden"
            style={{
              borderRadius: '32px 32px 0 0',
              boxShadow: '0 -6px 32px rgba(79,70,229,0.10)',
              paddingBottom: 'max(32px, env(safe-area-inset-bottom, 0px))',
            }}
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={reduce ? { duration: 0.15 } : { type: 'spring', stiffness: 380, damping: 40 }}
          >
            {/* Handle */}
            <div className="w-9 h-1 rounded-full mx-auto mt-3 mb-5" style={{ background: 'rgba(79,70,229,0.15)' }} />

            <div className="overflow-hidden">
              <AnimatePresence mode="wait" initial={false}>
                {view === 'select' ? (
                  <motion.div
                    key="select"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, x: direction * -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, x: direction * 12 }}
                    transition={{ duration: reduce ? 0.12 : 0.26, ease: EASE }}
                  >
                    {/* Title */}
                    <motion.p
                      {...enterRow(0)}
                      className="text-[18px] font-bold px-6 mb-4"
                      style={{ color: '#0F172A', letterSpacing: '-0.01em' }}
                    >
                      Who&apos;s travelling?
                    </motion.p>

                    {/* Myself */}
                    <motion.button
                      {...enterRow(0.04)}
                      onClick={() => onClearToMyself()}
                      whileTap={{ scale: 0.985 }}
                      className="w-full flex items-center gap-3.5 px-6 py-3.5 text-left cursor-pointer active:bg-black/[0.02] transition-colors duration-150"
                      style={{ background: bookingForOther ? 'transparent' : '#EEF2FF' }}
                    >
                      <span
                        className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: '#4F46E5' }}
                      >
                        <User size={16} color="white" strokeWidth={1.8} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] font-semibold" style={{ color: '#0F172A' }}>Myself</span>
                        <span className="block text-[12px] font-medium mt-0.5" style={{ color: '#6366F1' }}>My own trip</span>
                      </span>
                      {!bookingForOther && (
                        <span
                          className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                          style={{ borderColor: '#4F46E5' }}
                        >
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#4F46E5' }} />
                        </span>
                      )}
                    </motion.button>

                    {/* Someone else, only shown once a rider has been filled in */}
                    {bookingForOther && (
                      <motion.button
                        {...enterRow(0.08)}
                        onClick={() => { setNameDraft(riderName); setPhoneDraft(riderPhone.replace('+91', '')); goToForm() }}
                        whileTap={{ scale: 0.985 }}
                        className="w-full flex items-center gap-3.5 px-6 py-3.5 text-left cursor-pointer active:bg-black/[0.02] transition-colors duration-150"
                        style={{ background: '#EEF2FF' }}
                      >
                        <span
                          className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ background: '#4F46E5' }}
                        >
                          <User size={16} color="white" strokeWidth={1.8} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[15px] font-semibold truncate" style={{ color: '#0F172A' }}>{riderName}</span>
                          <span className="block text-[12px] font-medium mt-0.5" style={{ color: '#6366F1' }}>{riderPhone}</span>
                        </span>
                        <span
                          className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                          style={{ borderColor: '#4F46E5' }}
                        >
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#4F46E5' }} />
                        </span>
                      </motion.button>
                    )}

                    {/* Add new rider */}
                    <motion.button
                      {...enterRow(bookingForOther ? 0.12 : 0.08)}
                      onClick={() => { setNameDraft(''); setPhoneDraft(''); goToForm() }}
                      whileTap={{ scale: 0.985 }}
                      className="w-full flex items-center gap-3.5 px-6 py-3.5 text-left border-t cursor-pointer active:bg-black/[0.02] transition-colors duration-150"
                      style={{ borderColor: '#F1F5FF' }}
                    >
                      <span className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0">
                        <UserPlus size={18} className="text-primary" strokeWidth={1.8} />
                      </span>
                      <span className="flex-1 text-left">
                        <span className="block text-[15px] font-semibold" style={{ color: '#4F46E5' }}>Add new rider</span>
                      </span>
                    </motion.button>

                    {/* Privacy note */}
                    <p className="text-[11px] font-medium px-6 pt-3 pb-5" style={{ color: '#94A3B8' }}>
                      Your contact details are never shared with the driver.
                    </p>

                    {/* CTA */}
                    <div className="px-6">
                      <button
                        onClick={onClose}
                        className="w-full py-4 rounded-full text-[15px] font-bold text-white active:scale-[0.98] transition-transform cursor-pointer"
                        style={{
                          background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                          boxShadow: '0 4px 20px rgba(79,70,229,0.40)',
                          minHeight: 52,
                        }}
                      >
                        Confirm
                      </button>
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="form"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, x: direction * 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, x: direction * -12 }}
                    transition={{ duration: reduce ? 0.12 : 0.26, ease: EASE }}
                  >
                    {/* Title with back */}
                    <div className="flex items-center gap-2 px-4 mb-4">
                      <motion.button
                        onClick={goToSelect}
                        aria-label="Back"
                        whileTap={{ scale: 0.9 }}
                        className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 cursor-pointer active:bg-black/[0.04] transition-colors duration-150"
                      >
                        <ChevronLeft size={20} style={{ color: '#0F172A' }} />
                      </motion.button>
                      <p className="text-[18px] font-bold" style={{ color: '#0F172A', letterSpacing: '-0.01em' }}>
                        Rider details
                      </p>
                    </div>

                    <div className="px-6 flex flex-col gap-3">
                      <input
                        value={nameDraft}
                        onChange={e => setNameDraft(e.target.value)}
                        placeholder="Rider's full name"
                        aria-label="Rider's full name"
                        maxLength={50}
                        className="w-full px-4 rounded-2xl text-[15px] font-medium outline-none placeholder:text-[#475569] focus:ring-2 focus:ring-[#4F46E5]/40 transition-shadow duration-150"
                        style={{ background: '#F5F7FF', color: '#0F172A', height: 52 }}
                      />
                      <input
                        value={phoneDraft}
                        onChange={e => setPhoneDraft(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        placeholder="10-digit mobile number"
                        aria-label="Rider's 10-digit mobile number"
                        inputMode="numeric"
                        maxLength={10}
                        className="w-full px-4 rounded-2xl text-[15px] font-medium outline-none placeholder:text-[#475569] focus:ring-2 focus:ring-[#4F46E5]/40 transition-shadow duration-150"
                        style={{ background: '#F5F7FF', color: '#0F172A', height: 52 }}
                      />
                    </div>

                    {/* Privacy note */}
                    <p className="text-[11px] font-medium px-6 pt-3 pb-5" style={{ color: '#94A3B8' }}>
                      Your contact details are never shared with the driver.
                    </p>

                    {/* Save */}
                    <div className="px-6">
                      <button
                        disabled={nameDraft.trim().length === 0 || phoneDraft.length !== 10}
                        onClick={() => onCommit(nameDraft.trim(), `+91${phoneDraft}`)}
                        className="w-full py-4 rounded-full text-[15px] font-bold text-white active:scale-[0.98] transition-transform disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                        style={{
                          background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                          boxShadow: '0 4px 20px rgba(79,70,229,0.40)',
                          minHeight: 52,
                        }}
                      >
                        Save rider
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
