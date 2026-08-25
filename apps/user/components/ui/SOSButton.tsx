'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { SHEET_SPRING } from '@/lib/motion'

interface SOSButtonProps {
  onSOS: () => void | Promise<void>
  className?: string
}

export default function SOSButton({ onSOS, className }: SOSButtonProps) {
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending]       = useState(false)
  const [sent, setSent]             = useState(false)

  const handleSend = async () => {
    setSending(true)
    try {
      await Promise.resolve(onSOS())
      setSent(true)
      setTimeout(() => {
        setSent(false)
        setConfirming(false)
      }, 2500)
    } catch {
      setConfirming(false)
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        aria-label="SOS"
        className={`w-12 h-12 rounded-full bg-status-error flex items-center justify-center shadow-[0_4px_16px_rgba(239,68,68,0.35)] active:scale-95 transition-transform ${className ?? ''}`}
      >
        <span className="text-white font-bold text-[11px] tracking-widest">SOS</span>
      </button>

      <AnimatePresence>
        {confirming && (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
              onClick={() => { if (!sending) setConfirming(false) }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={SHEET_SPRING}
              className="relative w-full max-w-[430px] bg-white rounded-t-[28px] px-6 pt-6 shadow-[0_-8px_40px_rgba(0,0,0,0.14)]"
              style={{ paddingBottom: 'max(2.5rem, env(safe-area-inset-bottom))' }}
            >
              <div className="w-12 h-1.5 rounded-full bg-gray-200 mx-auto mb-6" />
              {sent ? (
                <>
                  <div className="w-14 h-14 rounded-full bg-status-success/15 flex items-center justify-center mx-auto mb-4">
                    <span className="text-status-success font-bold text-2xl">✓</span>
                  </div>
                  <h2 className="text-text-primary font-bold text-xl text-center mb-2">SOS Alert Sent</h2>
                  <p className="text-text-secondary text-sm text-center">Help is on the way. Stay safe.</p>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-full bg-status-error/15 flex items-center justify-center mx-auto mb-4">
                    <span className="text-status-error font-bold text-xl">!</span>
                  </div>
                  <h2 className="text-text-primary font-bold text-xl text-center mb-2">Send SOS Alert?</h2>
                  <p className="text-text-secondary text-sm text-center mb-8">
                    This will immediately alert our safety team and share your live location and trip details.
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setConfirming(false)}
                      disabled={sending}
                      className="flex-1 py-3.5 rounded-2xl text-sm font-bold text-gray-700 bg-gray-100 disabled:opacity-50 active:scale-[0.98] transition-transform"
                      style={{ minHeight: 56 }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => void handleSend()}
                      disabled={sending}
                      className="flex-1 py-3.5 rounded-2xl text-sm font-bold text-white bg-status-error disabled:opacity-60 active:scale-[0.98] transition-transform"
                      style={{ minHeight: 56 }}
                    >
                      {sending ? 'Sending…' : 'Send SOS'}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
