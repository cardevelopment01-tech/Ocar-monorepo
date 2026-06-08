'use client'

import { ArrowDownLeft, ArrowUpRight, Plus, ChevronRight } from 'lucide-react'
import { mockUser, mockTransactions } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export default function WalletPage() {
  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Balance card */}
      <div className="bg-primary px-6 pt-safe-top pb-8 rounded-b-3xl">
        <h1 className="text-white/70 text-sm font-medium pt-6 mb-2">Ocar Wallet</h1>
        <p className="text-4xl font-bold text-white mb-1">
          ₹{mockUser.walletBalance.toLocaleString('en-IN')}
        </p>
        <p className="text-white/60 text-xs">Available balance</p>

        <button className="mt-6 bg-white rounded-2xl px-6 py-3 flex items-center gap-2 w-full justify-center font-semibold text-primary shadow-button">
          <Plus size={18} />
          Add Money
        </button>
      </div>

      {/* Quick amounts */}
      <div className="px-4 -mt-4">
        <div className="card flex gap-2">
          {[100, 200, 500, 1000].map(amt => (
            <button
              key={amt}
              className="flex-1 bg-background rounded-xl py-2.5 text-sm font-semibold text-primary"
            >
              +₹{amt}
            </button>
          ))}
        </div>
      </div>

      {/* Payment Methods */}
      <div className="px-4 mt-6">
        <h2 className="text-sm font-bold text-text-primary mb-3">Payment Methods</h2>
      </div>
      <div className="px-4 -mt-3">
        <div className="card flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-background flex items-center justify-center text-xl">💳</div>
            <div>
              <p className="text-sm font-semibold text-text-primary">Link UPI</p>
              <p className="text-xs text-text-muted">Pay directly from bank</p>
            </div>
          </div>
          <ChevronRight size={18} className="text-text-muted" />
        </div>
      </div>

      {/* Transactions */}
      <div className="px-4 mt-6">
        <h2 className="text-sm font-bold text-text-primary mb-3">Transactions</h2>
        <div className="card p-0 divide-y divide-border">
          {mockTransactions.map(tx => (
            <div key={tx.id} className="flex items-center gap-3 px-4 py-4">
              <div className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                tx.type === 'credit' ? 'bg-status-success/10' : 'bg-status-error/10'
              )}>
                {tx.type === 'credit'
                  ? <ArrowDownLeft size={18} className="text-status-success" />
                  : <ArrowUpRight size={18} className="text-status-error" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-primary truncate">{tx.label}</p>
                <p className="text-xs text-text-muted">{tx.date}</p>
              </div>
              <p className={cn(
                'font-bold text-sm flex-shrink-0',
                tx.type === 'credit' ? 'text-status-success' : 'text-status-error'
              )}>
                {tx.type === 'credit' ? '+' : '-'}₹{tx.amount}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
