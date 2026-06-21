import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car, CornerUpLeft, ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'

const EASE = [0.22, 1, 0.36, 1] as const

const cardVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: (i: number) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.4, ease: EASE, delay: i * 0.08 },
  }),
}

export default function ModeSelection() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-bg text-text-primary px-5 pt-14 pb-12">

      {/* Header */}
      <motion.div
        className="flex items-center gap-3 mb-8"
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
        <div>
          <p className="text-text-muted text-[10px] font-bold uppercase tracking-widest mb-0.5">
            Ready to earn?
          </p>
          <h1 className="font-display text-[22px] font-bold text-text-primary leading-tight">
            How do you want to drive?
          </h1>
        </div>
      </motion.div>

      <div className="space-y-3">

        {/* ── Standard Mode ── */}
        <motion.button
          custom={0}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          onClick={() => navigate('/go-online/standard')}
          className="w-full driver-card text-left overflow-hidden relative"
          style={{ padding: 0 }}
        >
          {/* Accent band */}
          <div
            className="absolute top-0 left-0 right-0 h-1.5"
            style={{ background: 'linear-gradient(90deg, #3B82F6 0%, #6366F1 100%)' }}
          />
          <div className="p-5 pt-6">
            <div className="flex items-start gap-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(37,99,235,0.10)' }}
              >
                <Car size={26} style={{ color: '#2563EB' }} strokeWidth={1.8} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="font-display text-[17px] font-bold text-text-primary">Standard Mode</p>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto flex-shrink-0"
                    style={{ background: 'rgba(37,99,235,0.10)', color: '#2563EB' }}
                  >
                    Recommended
                  </span>
                </div>
                <p className="text-text-secondary text-sm leading-snug">
                  Accept rides anywhere in the city. Best for maximising earnings.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: 'rgba(37,99,235,0.08)', color: '#2563EB' }}
                  >
                    All areas
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface-3 text-text-muted">
                    No restriction
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="text-text-muted flex-shrink-0 mt-0.5" />
            </div>
          </div>
        </motion.button>

        {/* ── Return Cab ── */}
        <motion.button
          custom={1}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 340, damping: 30 }}
          onClick={() => navigate('/go-online/return-cab')}
          className="w-full driver-card text-left overflow-hidden relative"
          style={{ padding: 0 }}
        >
          {/* Accent band */}
          <div
            className="absolute top-0 left-0 right-0 h-1.5"
            style={{ background: 'linear-gradient(90deg, #F97316 0%, #EA580C 100%)' }}
          />
          <div className="p-5 pt-6">
            <div className="flex items-start gap-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                style={{ background: 'rgba(249,115,22,0.10)' }}
              >
                <CornerUpLeft size={26} style={{ color: '#F97316' }} strokeWidth={1.8} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <p className="font-display text-[17px] font-bold text-text-primary">Return Cab</p>
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full ml-auto flex-shrink-0"
                    style={{ background: 'rgba(249,115,22,0.10)', color: '#EA580C' }}
                  >
                    Headed home
                  </span>
                </div>
                <p className="text-text-secondary text-sm leading-snug">
                  Set a destination and only accept rides heading that way.
                </p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ background: 'rgba(249,115,22,0.08)', color: '#EA580C' }}
                  >
                    Direction-based
                  </span>
                  <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-surface-3 text-text-muted">
                    Earn on the way
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="text-text-muted flex-shrink-0 mt-0.5" />
            </div>
          </div>
        </motion.button>

      </div>

      <p className="text-text-muted text-xs text-center mt-6">
        You can go offline at any time from the home screen
      </p>
    </div>
  )
}
