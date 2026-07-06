'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronDown, Mail } from 'lucide-react'

const FAQS = [
  {
    q: 'How do I book a cab?',
    a: 'Tap the search bar on the home screen, enter your destination, choose a vehicle category, and confirm your booking. A nearby driver will be assigned within seconds.',
  },
  {
    q: 'What cities does Ocar operate in?',
    a: 'Ocar currently operates in Bhubaneswar, Cuttack, and Puri — including intercity routes between all three cities.',
  },
  {
    q: 'How do I start my ride?',
    a: 'Once the driver arrives, share the 4-digit OTP shown on your ride tracking screen with the driver. The trip begins only after the driver enters the correct OTP.',
  },
  {
    q: 'Can I cancel a booked ride?',
    a: 'Yes. Open the ride tracking screen and tap Cancel. Cancellations before the driver arrives are free. Cancellation charges may apply after the driver has reached your pickup point.',
  },
  {
    q: 'How do I pay for my ride?',
    a: 'Currently all rides are paid in cash directly to the driver at the end of the trip. UPI and card payments are coming soon.',
  },
]

export default function HelpPage() {
  const router = useRouter()
  const [open, setOpen] = useState<number | null>(null)

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
        <p className="text-[15px] font-bold text-slate-900">Help & Support</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-28">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">FAQs</p>
        <div className="bg-surface rounded-2xl border border-border overflow-hidden shadow-card mb-5">
          {FAQS.map((faq, i) => (
            <div key={i} className={i < FAQS.length - 1 ? 'border-b border-border' : ''}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
              >
                <span className="flex-1 text-sm font-semibold text-text-primary">{faq.q}</span>
                <ChevronDown
                  size={15}
                  strokeWidth={2}
                  className={`text-text-muted flex-shrink-0 transition-transform duration-200${open === i ? ' rotate-180' : ''}`}
                />
              </button>
              {open === i && (
                <p className="px-4 pb-4 text-xs text-text-muted leading-relaxed">{faq.a}</p>
              )}
            </div>
          ))}
        </div>

        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">Contact</p>
        <a
          href="mailto:support@ocar.in"
          className="flex items-center gap-3 bg-surface rounded-2xl border border-border px-4 py-3.5 shadow-card"
        >
          <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
            <Mail size={15} strokeWidth={1.6} className="text-text-muted" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold text-text-primary">Email support</span>
            <span className="block text-xs text-text-muted mt-0.5">support@ocar.in</span>
          </span>
        </a>
      </div>
    </div>
  )
}
