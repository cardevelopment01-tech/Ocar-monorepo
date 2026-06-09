import { useNavigate } from 'react-router-dom'
import { ArrowLeft, AlertTriangle, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import StatusBar from '@/components/ui/StatusBar'
import { useSessionStore } from '@/store/useSessionStore'
import { mockWalletTransactions, mockDriver, mockEarnings } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export default function Wallet() {
  const navigate = useNavigate()
  const { isOnline } = useSessionStore()
  const { balance, minimum } = mockDriver.wallet
  const isLow = balance < minimum

  return (
    <div className="min-h-screen bg-bg text-text-primary pb-10">
      <StatusBar isOnline={isOnline} earningsToday={mockEarnings.today.total} />

      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-16 pb-4">
        <button
          onClick={() => navigate(-1)}
          className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center"
        >
          <ArrowLeft size={20} className="text-text-secondary" />
        </button>
        <h1 className="text-xl font-bold">Wallet</h1>
      </div>

      {/* Balance card */}
      <div
        className="mx-4 rounded-3xl p-6 mb-4"
        style={{
          background: 'linear-gradient(135deg, #16A34A 0%, #22C55E 100%)',
          boxShadow: '0 8px 32px rgba(34,197,94,0.25)',
        }}
      >
        <p className="text-white/70 text-xs font-semibold uppercase tracking-wider mb-1">
          Compliance Deposit
        </p>
        <p className="text-white font-black text-[44px] leading-none">
          ₹{balance.toLocaleString('en-IN')}
        </p>
        <p className="text-white/60 text-xs mt-2">Minimum required: ₹{minimum.toLocaleString('en-IN')}</p>
      </div>

      {/* Low balance warning */}
      {isLow && (
        <div className="mx-4 bg-accent-amber/10 border border-accent-amber/30 rounded-2xl px-4 py-3 flex items-center gap-3 mb-4">
          <AlertTriangle size={20} className="text-accent-amber flex-shrink-0" />
          <div>
            <p className="text-accent-amber font-bold text-sm">Low Balance</p>
            <p className="text-text-secondary text-xs">
              Add ₹{(minimum - balance).toLocaleString('en-IN')} to avoid service interruption
            </p>
          </div>
        </div>
      )}

      {/* Add money */}
      <div className="mx-4 bg-surface rounded-3xl p-5 mb-4 border border-border">
        <p className="text-text-secondary text-sm font-semibold mb-3">Add Money</p>
        <div className="flex gap-2 mb-4 flex-wrap">
          {[500, 1000, 2000, 5000].map(amt => (
            <button
              key={amt}
              className="bg-surface-3 border border-border rounded-xl px-4 py-2 text-sm font-bold text-text-secondary hover:border-primary hover:text-primary transition-colors"
            >
              +₹{amt.toLocaleString('en-IN')}
            </button>
          ))}
        </div>
        <button className="btn-go w-full" style={{ minHeight: 52 }}>Add via UPI</button>
      </div>

      {/* Transactions */}
      <div className="mx-4 bg-surface rounded-3xl p-5 border border-border">
        <p className="text-text-secondary text-sm font-semibold mb-4">Recent Transactions</p>
        {mockWalletTransactions.map(tx => (
          <div key={tx.id} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
            <div className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0',
              tx.type === 'credit' ? 'bg-primary/10' : 'bg-accent-red/10'
            )}>
              {tx.type === 'credit'
                ? <ArrowDownLeft size={16} className="text-primary" />
                : <ArrowUpRight size={16} className="text-accent-red" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-text-primary text-sm font-semibold">{tx.label}</p>
              <p className="text-text-muted text-xs">{tx.date}</p>
            </div>
            <p className={cn(
              'font-bold text-sm flex-shrink-0',
              tx.type === 'credit' ? 'text-primary' : 'text-accent-red'
            )}>
              {tx.type === 'credit' ? '+' : '-'}₹{tx.amount.toLocaleString('en-IN')}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
