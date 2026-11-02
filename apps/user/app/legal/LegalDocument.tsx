import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock, Mail, MapPin, Phone } from 'lucide-react'

import { COMPANY, LEGAL_LAST_UPDATED } from '@/lib/company'
import { LegalToc } from './LegalToc'
import { PolicySwitcher } from './PolicySwitcher'
import { PrintButton } from './PrintButton'
import { POLICIES } from './policies'

export type LegalSection = {
  heading: string
  body: React.ReactNode
}

function slug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/&amp;|&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// "3. How we use it" -> { num: '3', text: 'How we use it' }; unnumbered headings pass through.
function splitHeading(heading: string): { num: string | null; text: string } {
  const m = /^(\d+)\.\s+(.*)$/.exec(heading)
  return m ? { num: m[1]!, text: m[2]! } : { num: null, text: heading }
}

const PROSE =
  'max-w-[68ch] space-y-4 text-[16px] leading-[1.75] text-text-secondary [text-wrap:pretty] ' +
  '[&_a]:font-semibold [&_a]:text-primary-dark [&_a]:underline [&_a]:decoration-primary-light [&_a]:underline-offset-[3px] hover:[&_a]:decoration-primary-dark ' +
  '[&_strong]:font-semibold [&_strong]:text-text-primary ' +
  '[&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_li]:pl-1 [&_li]:marker:text-text-muted'

const CONTACT_LINK = 'font-semibold text-primary-dark underline decoration-primary-light underline-offset-[3px]'

// Server component: policy pages must render fully in the initial HTML so a reviewer (or crawler) sees the
// content without running any script. Only the contents highlight and the print button are client code.
export function LegalDocument({
  title,
  intro,
  currentHref,
  sections,
  summary,
  updated,
  version,
}: {
  title: string
  intro: string
  currentHref: string
  sections: LegalSection[]
  /** Plain-language key points shown above the full text. */
  summary?: string[]
  /** Overrides the date in policies.ts. */
  updated?: string
  version?: string
}) {
  const toc = sections.map((s) => ({ id: slug(s.heading), label: s.heading }))
  const index = POLICIES.findIndex((p) => p.href === currentHref)
  const prev = index > 0 ? POLICIES[index - 1] : undefined
  const next = index >= 0 && index < POLICIES.length - 1 ? POLICIES[index + 1] : undefined
  const lastUpdated = updated ?? POLICIES[index]?.updated ?? LEGAL_LAST_UPDATED

  return (
    <div className="bg-surface print:bg-white">
      <header className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 pb-10 pt-8 sm:px-6 md:pb-12 md:pt-12">
          <nav aria-label="Breadcrumb" className="text-[13px] text-text-muted print:hidden">
            <Link href="/legal" className="rounded font-medium text-text-secondary underline-offset-4 hover:text-primary-dark hover:underline">
              Legal
            </Link>
            <span aria-hidden className="mx-2">/</span>
            <span aria-current="page">{title}</span>
          </nav>
          <h1 className="mt-4 max-w-3xl text-balance font-display text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-text-primary sm:text-[44px]">
            {title}
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] leading-[1.65] text-text-secondary">{intro}</p>
          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] tabular-nums text-text-secondary">
              <span>
                Last updated <time className="font-semibold text-text-primary">{lastUpdated}</time>
              </span>
              {version ? (
                <>
                  <span aria-hidden className="text-border">|</span>
                  <span>Version {version}</span>
                </>
              ) : null}
            </p>
            <PrintButton />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 md:py-14 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-16">
        <aside className="min-w-0 print:hidden lg:-ml-3 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
          <PolicySwitcher currentHref={currentHref} />

          <div className="mt-8 hidden lg:block">
            <LegalToc items={toc} />
          </div>
        </aside>

        <article className="min-w-0">
          <details className="group mb-8 rounded-xl border border-border lg:hidden print:hidden">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-[14px] font-semibold text-text-primary">
              On this page
              <ChevronDown aria-hidden className="h-4 w-4 transition-transform duration-150 group-open:rotate-180" />
            </summary>
            <ul className="space-y-0.5 border-t border-border p-2">
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className="flex min-h-11 items-center rounded-lg px-3 text-[14px] text-text-secondary hover:bg-surface-2">
                    {t.label}
                  </a>
                </li>
              ))}
            </ul>
          </details>

          {summary && summary.length > 0 ? (
            <section aria-labelledby="in-short" className="mb-12 max-w-[68ch] rounded-2xl border border-border bg-surface-2 p-5 sm:p-7">
              <h2 id="in-short" className="font-display text-[19px] font-semibold tracking-tight text-text-primary">
                In short
              </h2>
              <ul className="mt-4 space-y-3">
                {summary.map((point) => (
                  <li key={point} className="flex gap-3 text-[15.5px] leading-[1.65] text-text-primary">
                    <Check aria-hidden className="mt-1 h-4 w-4 flex-shrink-0 text-primary-dark" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[13.5px] leading-relaxed text-text-muted">
                This summary is for convenience. The full text below is what applies.
              </p>
            </section>
          ) : null}

          <div className="space-y-14">
            {sections.map((s) => {
              const id = slug(s.heading)
              const { num, text } = splitHeading(s.heading)
              return (
                <section key={id} id={id} className="scroll-mt-24 print:break-inside-avoid-page">
                  <h2 className="font-display text-[24px] font-semibold leading-snug tracking-[-0.01em] text-text-primary">
                    <a href={`#${id}`} className="rounded outline-offset-4 hover:text-primary-dark">
                      {num ? <span className="mr-2 font-sans font-medium tabular-nums text-text-muted">{num}.</span> : null}
                      {text}
                    </a>
                  </h2>
                  <div className={`mt-5 ${PROSE}`}>{s.body}</div>
                </section>
              )
            })}
          </div>

          <section aria-labelledby="questions" className="mt-16 max-w-[68ch] rounded-2xl border border-border p-6 sm:p-8 print:break-inside-avoid">
            <h2 id="questions" className="font-display text-[20px] font-semibold tracking-tight text-text-primary">
              Questions about this page?
            </h2>
            <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-text-secondary">
              Write to us and a person will reply. We acknowledge every message within 48 hours.
            </p>
            <dl className="mt-6 grid gap-5 text-[14.5px] sm:grid-cols-2">
              <ContactRow icon={Mail} label="Email">
                <a className={CONTACT_LINK} href={`mailto:${COMPANY.supportEmail}`}>
                  {COMPANY.supportEmail}
                </a>
              </ContactRow>
              <ContactRow icon={Phone} label="Phone">
                <a className={CONTACT_LINK} href={`tel:${COMPANY.supportPhone.replace(/\s/g, '')}`}>
                  {COMPANY.supportPhone}
                </a>
              </ContactRow>
              <ContactRow icon={Clock} label="Hours">
                {COMPANY.supportHours}
              </ContactRow>
              <ContactRow icon={MapPin} label="Registered office">
                <span className="block">{COMPANY.legalName}</span>
                <span className="block">{COMPANY.address.line1},</span>
                <span className="block">
                  {COMPANY.address.city}, {COMPANY.address.state} {COMPANY.address.pincode}, {COMPANY.address.country}
                </span>
              </ContactRow>
            </dl>
          </section>

          <nav aria-label="Other policies" className="mt-10 grid max-w-[68ch] gap-3 sm:grid-cols-2 print:hidden">
            {prev ? (
              <Link href={prev.href} className="group flex items-center gap-3 rounded-2xl border border-border p-4 transition-colors hover:bg-surface-2">
                <ArrowLeft aria-hidden className="h-4 w-4 flex-shrink-0 text-text-muted transition-transform duration-150 group-hover:-translate-x-0.5" />
                <span>
                  <span className="block text-[12.5px] text-text-muted">Previous</span>
                  <span className="block text-[15px] font-semibold text-text-primary">{prev.label}</span>
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={next.href} className="group flex items-center justify-end gap-3 rounded-2xl border border-border p-4 text-right transition-colors hover:bg-surface-2">
                <span>
                  <span className="block text-[12.5px] text-text-muted">Next</span>
                  <span className="block text-[15px] font-semibold text-text-primary">{next.label}</span>
                </span>
                <ArrowRight aria-hidden className="h-4 w-4 flex-shrink-0 text-text-muted transition-transform duration-150 group-hover:translate-x-0.5" />
              </Link>
            ) : null}
          </nav>
        </article>
      </div>
    </div>
  )
}

function ContactRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <Icon aria-hidden className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" />
      <div>
        <dt className="text-[12.5px] text-text-muted">{label}</dt>
        <dd className="mt-0.5 text-text-secondary">{children}</dd>
      </div>
    </div>
  )
}
