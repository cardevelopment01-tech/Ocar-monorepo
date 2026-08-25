'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Banknote, CreditCard, Wallet, Check } from 'lucide-react'
import { getPaymentChannel, setPaymentChannel, type PaymentChannel } from '@/lib/payment-channel'

const OPTIONS: Array<{ id: PaymentChannel; Icon: typeof Banknote; label: string; sub: string }> = [
  { id: 'cash',   Icon: Banknote,   label: 'Cash',        sub: 'Pay directly to driver' },
  { id: 'online', Icon: CreditCard, label: 'UPI / Cards', sub: 'Pay online via Razorpay' },
  { id: 'wallet', Icon: Wallet,     label: 'Ocar Wallet', sub: 'Use your wallet balance' },
]

export default function PaymentMethodsPage() {
  const router = useRouter()
  const [selected, setSelected] = useState<PaymentChannel>('cash')

  useEffect(() => { setSelected(getPaymentChannel()) }, [])

  const choose = (id: PaymentChannel) => {
    setSelected(id)
    setPaymentChannel(id)
  }

  return (
    <div className="h-full flex flex-col bg-background">
      <div
        className="flex-shrink-0 flex items-center gap-3 px-4 border-b border-slate-100"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)', paddingBottom: 12 }}
      >
        <button
          onClick={() => router.back()}
          aria-label="Go back"
          className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center flex-shrink-0 active:bg-slate-200 transition-colors"
        >
          <ArrowLeft size={17} strokeWidth={2} className="text-slate-800" />
        </button>
        <p className="text-[15px] font-bold text-slate-900">Payment methods</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-28">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">
          Choose how you pay
        </p>
        <div className="card p-0 overflow-hidden">
          {OPTIONS.map((item, i, arr) => {
            const active = selected === item.id
            return (
              <button
                key={item.id}
                onClick={() => choose(item.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 text-left${i < arr.length - 1 ? ' border-b border-border' : ''}`}
              >
                <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
                  <item.Icon size={15} strokeWidth={1.6} className="text-text-primary" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-text-primary">{item.label}</span>
                  <span className="block text-xs text-text-muted mt-0.5">{item.sub}</span>
                </span>
                {active && (
                  <span className="w-6 h-6 rounded-full bg-status-success/10 flex items-center justify-center flex-shrink-0">
                    <Check size={13} strokeWidth={2.5} className="text-status-success" />
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
