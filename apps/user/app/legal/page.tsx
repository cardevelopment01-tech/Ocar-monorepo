import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

import { COMPANY, LEGAL_LAST_UPDATED, formatAddress } from '@/lib/company'
import { POLICIES } from './policies'

export const metadata = {
  title: 'Legal',
  description: 'Ocar terms, privacy policy, refund and cancellation, delivery and account deletion.',
}

export default function LegalIndexPage() {
  return (
    <div className="bg-surface">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 md:pb-14 md:pt-14">
          <h1 className="text-balance font-display text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-text-primary sm:text-[44px]">
            Legal and policies
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] leading-[1.65] text-text-secondary">
            The agreements and policies that apply when you ride or drive with Ocar, in plain language where we can.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 md:py-14">
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {POLICIES.map((p) => (
            <li key={p.href}>
              <Link
                href={p.href}
                className="group flex items-center justify-between gap-4 p-5 transition-colors hover:bg-surface-2 sm:p-6"
              >
                <span className="min-w-0">
                  <span className="block font-display text-[19px] font-semibold tracking-tight text-text-primary">{p.label}</span>
                  <span className="mt-1 block max-w-[62ch] text-[15px] leading-relaxed text-text-secondary">{p.description}</span>
                </span>
                <ArrowRight aria-hidden className="h-5 w-5 flex-shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-primary-dark" />
              </Link>
            </li>
          ))}
        </ul>

        <section aria-labelledby="who" className="mt-12 grid gap-8 sm:grid-cols-2">
          <div>
            <h2 id="who" className="font-display text-[19px] font-semibold tracking-tight text-text-primary">Who we are</h2>
            <p className="mt-3 max-w-[48ch] text-[15px] leading-[1.7] text-text-secondary">
              {COMPANY.brand} is operated by {COMPANY.legalName}, a company registered in India (GSTIN {COMPANY.gstin}).
              Registered office: {formatAddress()}.
            </p>
          </div>
          <div>
            <h2 className="font-display text-[19px] font-semibold tracking-tight text-text-primary">Contact</h2>
            <p className="mt-3 text-[15px] leading-[1.7] text-text-secondary">
              <a className="font-semibold text-primary-dark underline decoration-primary-light underline-offset-[3px]" href={`mailto:${COMPANY.supportEmail}`}>
                {COMPANY.supportEmail}
              </a>
              <br />
              {COMPANY.supportPhone} · {COMPANY.supportHours}
            </p>
            <p className="mt-3 text-[13.5px] text-text-muted">Policies last reviewed {LEGAL_LAST_UPDATED}.</p>
          </div>
        </section>
      </div>
    </div>
  )
}
