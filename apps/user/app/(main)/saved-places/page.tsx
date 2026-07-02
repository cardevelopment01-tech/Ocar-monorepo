'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, MapPin, Home, Briefcase } from 'lucide-react'

export default function SavedPlacesPage() {
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
        <p className="text-[15px] font-bold text-slate-900">Saved places</p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-28">
        <p className="text-[11px] font-semibold text-text-muted uppercase tracking-widest mb-3">Your places</p>
        <div className="bg-surface rounded-2xl border border-border overflow-hidden shadow-card">
          {[
            { Icon: Home,      label: 'Home',  sub: 'Add your home address'   },
            { Icon: Briefcase, label: 'Work',  sub: 'Add your work address'   },
            { Icon: MapPin,    label: 'Other', sub: 'Add a custom saved place' },
          ].map((item, i, arr) => (
            <div
              key={item.label}
              className={`flex items-center gap-3 px-4 py-3.5${i < arr.length - 1 ? ' border-b border-border' : ''}`}
            >
              <span className="w-9 h-9 rounded-xl bg-surface-2 flex items-center justify-center flex-shrink-0">
                <item.Icon size={15} strokeWidth={1.6} className="text-text-muted" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-text-primary">{item.label}</span>
                <span className="block text-xs text-text-muted mt-0.5">{item.sub}</span>
              </span>
              <span className="text-[10px] font-semibold text-text-muted bg-surface-2 rounded-lg px-2 py-1">Soon</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
