import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

import PageHero from '@/components/site/PageHero'
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
    .replace(/&amp;|&/g, 'and')
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
      <PageHero eyebrow="Legal" title={title}>
        <p>{intro}</p>
        <p className="mt-4 inline-flex rounded-full bg-white/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-white ring-1 ring-white/15">
          Last updated {LEGAL_LAST_UPDATED}
        </p>
      </PageHero>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:py-14 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-12">
        <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto">
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
                        ? 'block rounded-full bg-gradient-primary px-3.5 py-2 text-[13px] font-semibold text-text-inverse shadow-button lg:rounded-xl'
                        : 'block rounded-full border border-border bg-surface px-3.5 py-2 text-[13px] font-medium text-text-secondary transition-colors hover:text-primary-dark lg:rounded-xl lg:border-transparent lg:bg-transparent lg:hover:bg-primary-subtle'
                    }
                  >
                    {p.label}
                  </Link>
                </li>
              )
            })}
          </ul>

          <nav aria-label="On this page" className="mt-8 hidden lg:block">
            <p className="text-[12px] font-bold uppercase tracking-wide text-text-muted">On this page</p>
            <ul className="mt-3 space-y-0.5 border-l border-border">
              {sections.map((s) => (
                <li key={s.heading}>
                  <a
                    href={`#${slug(s.heading)}`}
                    className="-ml-px block border-l-2 border-transparent py-1.5 pl-3.5 text-[13px] leading-snug text-text-secondary transition-colors hover:border-primary hover:text-primary-dark"
                  >
                    {s.heading}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0 rounded-[28px] border border-border bg-surface p-6 shadow-card sm:p-8 md:p-12">
          {LEGAL_DRAFT_NOTICE && (
            <div className="mb-8 flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0 text-amber-600" />
              <p className="text-[12.5px] leading-relaxed text-amber-800">
                <span className="font-semibold">Draft pending legal review.</span> This document reflects
                Ocar&apos;s actual practices but has not yet been reviewed by a lawyer. Set
                LEGAL_DRAFT_NOTICE to false in lib/company.ts once counsel signs off.
              </p>
            </div>
          )}

          <div className="space-y-10">
            {sections.map((s) => (
              <section key={s.heading} id={slug(s.heading)} className="scroll-mt-24">
                <h2 className="flex items-center gap-3 font-display text-[21px] font-bold tracking-tight text-text-primary">
                  <span aria-hidden className="h-6 w-1 flex-shrink-0 rounded-full bg-gradient-primary" />
                  {s.heading}
                </h2>
                <div className="mt-4 max-w-[70ch] space-y-3 text-[15px] leading-[1.75] text-text-secondary [&_a]:font-semibold [&_a]:text-primary-dark [&_a]:underline [&_li]:marker:text-primary [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
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
