import { useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EASE, GLASS } from '@/lib/constants'
import { useNavPrefsStore } from '@/store/useNavPrefsStore'

interface HindiVoiceHintProps {
  /** Voice guidance has actually started announcing (a maneuver step exists). */
  active: boolean
}

// One-time, auto-dismissing hint — no dismiss button, since active-ride screens must
// not add mid-trip confirmation taps (docs/MAP_NAVIGATION_AUDIT_AND_PROPOSAL.md item 4).
export default function HindiVoiceHint({ active }: HindiVoiceHintProps) {
  const language = useNavPrefsStore(s => s.language)
  const voiceEnabled = useNavPrefsStore(s => s.voiceEnabled)
  const hindiHintShown = useNavPrefsStore(s => s.hindiHintShown)
  const markHindiHintShown = useNavPrefsStore(s => s.markHindiHintShown)

  const show = active && voiceEnabled && language === 'hi' && !hindiHintShown

  useEffect(() => {
    if (!show) return
    const t = setTimeout(markHindiHintShown, 6000)
    return () => clearTimeout(t)
  }, [show, markHindiHintShown])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="rounded-2xl px-4 py-3 mx-4"
          style={{
            ...GLASS,
            position: 'fixed', left: 0, right: 0, zIndex: 40,
            bottom: 'calc(env(safe-area-inset-bottom) + 100px)',
          }}
        >
          <p className="text-text-primary text-xs font-semibold text-center">
            Voice guidance is in Hindi — install the Hindi voice pack in phone settings if you don't hear it.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
