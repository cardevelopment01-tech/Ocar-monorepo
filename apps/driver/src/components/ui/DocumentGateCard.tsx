import { AlertCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'

const EASE = [0.22, 1, 0.36, 1] as const

interface DocumentGateCardProps {
  loading: boolean
  hasRejected: boolean
  rejectionReason: string | null
}

// Same "shown proactively, fixed spot, before Go Online is tapped" language
// as WalletGateCard.
export default function DocumentGateCard({ loading, hasRejected, rejectionReason }: DocumentGateCardProps) {
  const navigate = useNavigate()

  return (
    <AnimatePresence mode="wait">
      {loading ? (
        <motion.div
          key="skeleton"
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="h-16 rounded-2xl mb-3 animate-pulse bg-surface-2"
        />
      ) : hasRejected ? (
        <motion.div
          key="rejected"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="rounded-2xl px-4 py-3.5 mb-3 bg-red-50 border border-red-200"
        >
          <div className="flex items-start gap-3">
            <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-text-primary text-sm font-bold">Document needs attention</p>
              <p className="text-text-secondary text-[12px] mt-1 leading-relaxed">
                {rejectionReason ?? 'One of your documents was rejected. Resubmit it to go online.'}
              </p>
              <button
                onClick={() => navigate('/profile/documents')}
                className="mt-2.5 text-sm font-bold text-white bg-red-600 rounded-full px-4 py-2 active:opacity-80"
              >
                Fix documents
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
