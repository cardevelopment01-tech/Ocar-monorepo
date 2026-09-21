'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft, AlertTriangle } from 'lucide-react'

export const LAST_UPDATED = '20 September 2026'

export type LegalSection = {
  heading: string
  body: React.ReactNode
}

export function LegalDocument({
  title,
  crossLinkLabel,
  crossLinkHref,
  sections,
}: {
  title: string
  crossLinkLabel: string
  crossLinkHref: string
  sections: LegalSection[]
}) {
  const router = useRouter()

  return (
    <>
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
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-slate-900">{title}</p>
          <p className="text-[11px] text-text-muted">Last updated {LAST_UPDATED}</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-none px-4 pt-5 pb-28">
        {/* This draft has not been reviewed by a lawyer -- do not treat it as
            finalized legal text. Remove this banner once counsel signs off. */}
        <div className="mb-5 px-4 py-3 rounded-2xl border border-amber-200 bg-amber-50 flex items-start gap-2.5">
          <AlertTriangle size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed text-amber-800">
            <span className="font-semibold">Draft pending legal review.</span> This document reflects Ocar&apos;s
            actual data practices and service terms but has not yet been reviewed by a lawyer for legal
            sufficiency or compliance. Do not rely on it as final until this notice is removed.
          </p>
        </div>

        <div className="card p-0 overflow-hidden divide-y divide-border">
          {sections.map((s) => (
            <div key={s.heading} className="px-4 py-4">
              <h2 className="text-[13px] font-bold text-text-primary mb-1.5">{s.heading}</h2>
              <div className="text-[13px] leading-relaxed text-text-secondary space-y-2">{s.body}</div>
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push(crossLinkHref)}
          className="w-full text-center text-[12.5px] font-semibold text-primary mt-5"
        >
          {crossLinkLabel}
        </button>
      </div>
    </>
  )
}
