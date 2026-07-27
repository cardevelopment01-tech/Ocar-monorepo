import { AlertCircle, AlertTriangle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'

const EASE = [0.22, 1, 0.36, 1] as const

interface WalletGateCardProps {
  loading: boolean
  balance: number
  isFrozen: boolean
  isLow: boolean
  duesOwed: number | null
}

// Reuses Wallet.tsx's amber/red card language, but shown proactively — on load,
// in a fixed spot, never as an after-the-fact reflow — so a blocked driver sees
// exactly why before they ever tap "Go Online".
export default function WalletGateCard({ loading, balance, isFrozen, isLow, duesOwed }: WalletGateCardProps) {
  const navigate = useNavigate()

  if (loading) {
    return <div className="h-16 rounded-2xl mb-3 animate-pulse bg-surface-2" />
  }
  if (!isFrozen && duesOwed === null && !isLow) {
    return null
  }

  const motionProps = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: EASE },
  }

  if (isFrozen) {
    return (
      <motion.div {...motionProps} className="rounded-2xl px-4 py-3.5 mb-3 bg-red-50 border border-red-200">
        <div className="flex items-start gap-3">
          <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-text-primary text-sm font-bold">Wallet is frozen</p>
            <p className="text-text-secondary text-[12px] mt-1 leading-relaxed">
              Your wallet has been frozen. Contact support to resolve this before you can go online.
            </p>
          </div>
        </div>
      </motion.div>
    )
  }

  if (duesOwed !== null) {
    return (
      <motion.div {...motionProps} className="rounded-2xl px-4 py-3.5 mb-3 bg-red-50 border border-red-200">
        <div className="flex items-start gap-3">
          <AlertCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-text-primary text-sm font-bold">Clear your cash dues to go online</p>
            <p className="text-red-600 text-lg font-black mt-0.5">₹{Math.abs(duesOwed).toLocaleString('en-IN')}</p>
            <p className="text-text-secondary text-[12px] mt-1 leading-relaxed">
              Cash rides include the platform's commission — since you collected the cash directly, that
              commission is now owed. Digital rides net it off automatically, or you can top up now.
            </p>
            <button
              onClick={() => navigate('/wallet')}
              className="mt-2.5 text-sm font-bold text-white bg-red-600 rounded-full px-4 py-2 active:opacity-80"
            >
              Add money
            </button>
          </div>
        </div>
      </motion.div>
    )
  }

  // isLow
  return (
    <motion.div {...motionProps} className="rounded-2xl px-4 py-3.5 mb-3" style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.20)' }}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={15} className="text-accent-amber flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-text-primary text-sm font-bold">Add money to go online</p>
          <p className="text-text-secondary text-[12px] mt-1 leading-relaxed">
            Wallet: ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2 })} · Minimum required: ₹500
          </p>
          <button
            onClick={() => navigate('/wallet')}
            className="mt-2.5 text-sm font-bold text-white bg-accent-amber rounded-full px-4 py-2 active:opacity-80"
          >
            Add ₹{(500 - balance).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </button>
        </div>
      </div>
    </motion.div>
  )
}
