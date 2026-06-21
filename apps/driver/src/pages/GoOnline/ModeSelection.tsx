import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Car, CornerUpLeft, ChevronRight, Clock } from 'lucide-react'
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

        {/* ── Standard Mode — interactive ── */}
        <motion.button
          custom={0}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          whileTap={{ scale: 0.97 }}
          onClick={() => navigate('/go-online/standard')}
          className="w-full driver-card text-left relative overflow-hidden"
        >
          <span className="absolute top-3 right-4 font-display text-[40px] font-black leading-none select-none pointer-events-none text-slate-200">
            01
          </span>

          <div className="flex items-start gap-4 relative">
            <div className="w-14 h-14 rounded-2xl bg-[#0F172A] flex items-center justify-center flex-shrink-0">
              <Car size={26} className="text-white" strokeWidth={1.8} />
            </div>

            <div className="flex-1 min-w-0 pr-8">
              <div className="flex items-start justify-between mb-1.5">
                <p className="font-display text-[17px] font-bold text-text-primary">Standard Mode</p>
                <span className="inline-flex items-center gap-1 ml-2 flex-shrink-0 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted">
                    Operational
                  </span>
                </span>
              </div>
              <p className="text-text-secondary text-sm leading-snug mb-3">
                Accept rides anywhere in the city.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                  All areas
                </span>
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                  No restriction
                </span>
              </div>
            </div>
          </div>

          <ChevronRight size={18} className="text-[#0F172A] absolute right-5 top-1/2 -translate-y-1/2" strokeWidth={2.2} />
        </motion.button>

        {/* ── Return Cab — coming soon, non-interactive ── */}
        <motion.div
          custom={1}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="w-full driver-card text-left relative overflow-hidden opacity-55 cursor-not-allowed"
        >
          <span className="absolute top-3 right-4 font-display text-[40px] font-black leading-none select-none pointer-events-none text-slate-200">
            02
          </span>

          <div className="flex items-start gap-4 relative">
            <div className="w-14 h-14 rounded-2xl bg-slate-200 flex items-center justify-center flex-shrink-0">
              <CornerUpLeft size={26} className="text-slate-400" strokeWidth={1.8} />
            </div>

            <div className="flex-1 min-w-0 pr-8">
              <div className="flex items-start justify-between mb-1.5">
                <p className="font-display text-[17px] font-bold text-text-primary">Return Cab</p>
                <span className="inline-flex items-center ml-2 flex-shrink-0 mt-0.5 px-2 py-0.5 rounded-full bg-[#FEF3C7]">
                  <span className="text-[9px] font-bold uppercase tracking-[0.10em] text-[#B45309]">
                    Coming Soon
                  </span>
                </span>
              </div>
              <p className="text-text-secondary text-sm leading-snug mb-3">
                Set a destination and only accept rides heading that way.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-400">
                  One-way
                </span>
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-400">
                  Earn on the way
                </span>
              </div>
            </div>
          </div>

          <Clock size={18} className="text-amber-500 absolute right-5 top-1/2 -translate-y-1/2" strokeWidth={2.2} />
        </motion.div>

      </div>

      <p className="text-text-muted text-xs text-center mt-6">
        You can go offline at any time from the home screen
      </p>
    </div>
  )
}
