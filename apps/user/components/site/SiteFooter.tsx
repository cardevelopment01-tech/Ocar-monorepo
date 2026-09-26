import Link from 'next/link'
import { Mail, MapPin, Phone, ShieldCheck } from 'lucide-react'

import OcarLogoMark from '@/components/ui/OcarLogoMark'
import { CITIES_TEXT, COMPANY, formatAddress } from '@/lib/company'

const COMPANY_LINKS = [
  { href: '/about', label: 'About Ocar' },
  { href: '/pricing', label: 'Fares and services' },
  { href: '/contact', label: 'Contact us' },
]

const LEGAL_LINKS = [
  { href: '/legal/terms', label: 'Terms and Conditions' },
  { href: '/legal/privacy', label: 'Privacy Policy' },
  { href: '/legal/refund-cancellation', label: 'Refund and Cancellation Policy' },
  { href: '/legal/shipping', label: 'Shipping and Delivery Policy' },
]

export default function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-5">
          <OcarLogoMark size="sm" />
          <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed text-text-secondary">
            Intercity cab booking across {CITIES_TEXT}. Verified drivers, fares shown before
            you book, and every trip tracked live.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-primary-subtle px-3.5 py-2 text-[12px] font-semibold text-primary-dark">
            <ShieldCheck size={14} />
            Online payments processed by RBI-authorised gateways
          </div>
        </div>

        <nav aria-label="Company" className="md:col-span-2">
          <p className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Company</p>
          <ul className="mt-4 space-y-3">
            {COMPANY_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-[13.5px] text-text-secondary hover:text-primary-dark">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Legal" className="md:col-span-2">
          <p className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Policies</p>
          <ul className="mt-4 space-y-3">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="text-[13.5px] text-text-secondary hover:text-primary-dark">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <address className="not-italic md:col-span-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-text-muted">Reach us</p>
          <ul className="mt-4 space-y-3 text-[13.5px] text-text-secondary">
            <li className="flex gap-2.5">
              <MapPin size={15} className="mt-0.5 flex-shrink-0 text-primary" />
              <span>{formatAddress()}</span>
            </li>
            <li className="flex gap-2.5">
              <Phone size={15} className="mt-0.5 flex-shrink-0 text-primary" />
              <span>{COMPANY.supportPhone}</span>
            </li>
            <li className="flex gap-2.5">
              <Mail size={15} className="mt-0.5 flex-shrink-0 text-primary" />
              <a href={`mailto:${COMPANY.supportEmail}`} className="hover:text-primary-dark">
                {COMPANY.supportEmail}
              </a>
            </li>
          </ul>
        </address>
      </div>

      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 text-[12px] text-text-muted sm:px-6 md:flex-row md:items-center md:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {COMPANY.legalName}. All rights reserved.
          </p>
          <p>Ocar is a technology platform. Rides are provided by independent, verified drivers.</p>
        </div>
      </div>
    </footer>
  )
}
