import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import { LEGAL_DRAFT_NOTICE, LEGAL_LAST_UPDATED } from '@/lib/company'

export type LegalSection = {
  heading: string
  body: React.ReactNode
}

const POLICY_NAV = [
  { href: '/legal/terms', label: 'Terms and Conditions' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/refund-cancellation', label: 'Refund and Cancellation' },
  { href: '/legal/shipping', label: 'Shipping and Delivery' },
]

function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/&amp;/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Server component: policy pages must render fully in the initial HTML so a
// reviewer (or crawler) sees the content without running any script.
export function LegalDocument({
  title,
  intro,
  currentHref,
  sections,
}: {
  title: string
  intro: string
  currentHref: string
  sections: LegalSection[]
}) {
  return (
    <>
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-14">
          <h1 className="font-display text-3xl font-bold tracking-tight text-text-primary md:text-4xl">{title}</h1>
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-text-secondary">{intro}</p>
          <p className="mt-4 text-[12.5px] font-medium text-text-muted">Last updated {LEGAL_LAST_UPDATED}</p>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:gap-14">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <p className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Our policies</p>
          <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-1">
            {POLICY_NAV.map((p) => {
              const active = p.href === currentHref
              return (
                <li key={p.href}>
                  <Link
                    href={p.href}
                    aria-current={active ? 'page' : undefined}
                    className={
                      active
                        ? 'block rounded-full bg-primary-subtle px-3.5 py-2 text-[13px] font-semibold text-primary-dark lg:rounded-xl'
                        : 'block rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-text-secondary hover:text-primary-dark lg:rounded-xl lg:border-transparent lg:bg-transparent'
                    }
                  >
                    {p.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </aside>

        <article className="min-w-0">
          {LEGAL_DRAFT_NOTICE && (
            <div className="mb-6 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-amber-600" />
              <p className="text-[12.5px] leading-relaxed text-amber-800">
                <span className="font-semibold">Draft pending legal review.</span> This document reflects
                Ocar&apos;s actual practices but has not yet been reviewed by a lawyer. Set
                LEGAL_DRAFT_NOTICE to false in lib/company.ts once counsel signs off.
              </p>
            </div>
          )}

          <div className="space-y-9">
            {sections.map((s) => (
              <section key={s.heading} id={slug(s.heading)} className="scroll-mt-24">
                <h2 className="font-display text-[19px] font-bold tracking-tight text-text-primary">{s.heading}</h2>
                <div className="mt-3 max-w-[70ch] space-y-3 text-[14.5px] leading-relaxed text-text-secondary [&_a]:font-semibold [&_a]:text-primary-dark [&_a]:underline [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                  {s.body}
                </div>
              </section>
            ))}
          </div>
        </article>
      </div>
    </>
  )
}
