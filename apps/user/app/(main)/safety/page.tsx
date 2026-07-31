'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, Shield, AlertTriangle, UserPlus } from 'lucide-react'

export default function SafetyPage() {
  const router = useRouter()

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
        <p className="text-[15px] font-bold text-slate-900">Safety</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-28">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">In-ride SOS</p>
        <div className="card-glossy p-0 overflow-hidden mb-5">
          <div className="flex items-start gap-3 px-4 py-4">
            <span className="w-9 h-9 rounded-xl bg-status-error/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <AlertTriangle size={15} strokeWidth={1.6} className="text-status-error" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary mb-1">SOS button</p>
              <p className="text-xs text-text-muted leading-relaxed">
                During an active ride, tap the SOS button on the tracking screen to immediately alert our safety team. Your live location and ride details are shared automatically.
              </p>
            </div>
          </div>
        </div>

        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">Emergency contacts</p>
        <div className="bg-surface rounded-2xl border border-border overflow-hidden shadow-card">
          <div className="flex items-center gap-3 px-4 py-3.5">
            <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
              <UserPlus size={15} strokeWidth={1.6} className="text-text-muted" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-text-muted">Add emergency contact</span>
              <span className="block text-xs text-text-muted mt-0.5">Notified automatically during SOS</span>
            </span>
            <span className="text-[10px] font-semibold text-text-muted bg-surface-2 rounded-lg px-2 py-1">Soon</span>
          </div>
        </div>

        <div className="mt-4 px-1">
          <div className="flex items-start gap-2">
            <Shield size={12} strokeWidth={2} className="text-text-muted mt-0.5 flex-shrink-0" />
            <p className="text-xs text-text-muted leading-relaxed">
              All rides on Ocar are tracked end-to-end. Driver details including name, vehicle number and photo are verified before every trip.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
