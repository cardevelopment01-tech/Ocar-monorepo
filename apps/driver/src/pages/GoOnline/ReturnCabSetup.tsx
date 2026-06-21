import { useNavigate } from 'react-router-dom'
import { ArrowLeft, CornerUpLeft, Clock, MapPin, Route, Banknote } from 'lucide-react'
import { motion } from 'framer-motion'

const EASE = [0.22, 1, 0.36, 1] as const

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } },
}

const item = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
}

const FEATURES = [
  { icon: MapPin, label: 'Set your home destination' },
  { icon: Route, label: 'Only matching rides appear' },
  { icon: Banknote, label: 'Earn on the way back' },
]

export default function ReturnCabSetup() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-28 flex flex-col">

      {/* Header */}
      <motion.div
        className="flex items-center gap-3 mb-2"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: EASE }}
      >
        <button
          onClick={() => navigate(-1)}
          className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest">
          Go Online
        </p>
      </motion.div>

      {/* Centered main */}
      <motion.div
        className="flex-1 flex flex-col items-center justify-center text-center"
        variants={container}
        initial="hidden"
        animate="visible"
      >
        <motion.div
          variants={item}
          className="w-20 h-20 rounded-[24px] bg-[#0F172A] flex items-center justify-center mb-6"
          style={{ boxShadow: '0 0 48px rgba(245,158,11,0.18)' }}
        >
          <CornerUpLeft size={32} className="text-white" strokeWidth={1.8} />
        </motion.div>

        <motion.div
          variants={item}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 mb-5"
        >
          <Clock size={10} className="text-amber-600" strokeWidth={2.4} />
          <span className="text-[9px] font-bold uppercase tracking-widest text-amber-700">
            Coming Soon
          </span>
        </motion.div>

        <motion.h1 variants={item} className="font-display text-[28px] font-bold text-text-primary mb-3">
          Return Cab
        </motion.h1>

        <motion.p variants={item} className="text-text-secondary text-sm leading-relaxed max-w-[300px] mb-7">
          Set your destination and only get matched with rides heading your way — the smarter way to end your shift.
        </motion.p>

        <motion.div variants={item} className="w-full max-w-[280px] space-y-3 mb-6">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div key={label} className="flex items-center gap-3 text-left">
              <Icon size={16} className="text-text-muted flex-shrink-0" strokeWidth={1.9} />
              <span className="text-sm text-text-muted">{label}</span>
            </div>
          ))}
        </motion.div>

        <motion.p variants={item} className="text-text-muted text-xs">
          Expected Q3 2025
        </motion.p>
      </motion.div>

      {/* Fixed bottom CTA */}
      <div
        className="fixed bottom-0 left-0 right-0 px-5"
        style={{
          paddingBottom: 'max(20px, env(safe-area-inset-bottom))',
          paddingTop: 16,
          zIndex: 10,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          className="btn-secondary w-full"
          style={{ minHeight: 56, borderRadius: 24 }}
        >
          ← Back to Modes
        </button>
      </div>
    </div>
  )
}
