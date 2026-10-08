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

const linkCls = 'inline-block py-2.5 text-[13.5px] md:py-1.5 text-slate-300 transition-colors hover:text-white active:text-white'
const headCls = 'text-[12px] font-bold uppercase tracking-wide text-slate-400'

export default function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-gradient-hero text-slate-300">
      <div aria-hidden className="pointer-events-none absolute -left-20 top-0 h-72 w-72 rounded-full bg-primary/20 blur-[100px]" />
      <div aria-hidden className="pointer-events-none absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-accent/15 blur-[100px]" />

      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-12">
        <div className="md:col-span-5">
          <span className="inline-flex rounded-xl bg-white px-3 py-2">
            <OcarLogoMark size="sm" />
          </span>
          <p className="mt-4 max-w-sm text-[13.5px] leading-relaxed">
            Intercity cab booking across {CITIES_TEXT}. Verified drivers, fares shown before you book, and every trip
            tracked live.
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-[12px] font-semibold text-white ring-1 ring-white/15">
            <ShieldCheck size={14} className="text-primary-bright" />
            Online payments processed by RBI-authorised gateways
          </div>
        </div>

        <nav aria-label="Company" className="md:col-span-2">
          <p className={headCls}>Company</p>
          <ul className="mt-3 space-y-0.5">
            {COMPANY_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={linkCls}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Legal" className="md:col-span-2">
          <p className={headCls}>Policies</p>
          <ul className="mt-3 space-y-0.5">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={linkCls}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <address className="not-italic md:col-span-3">
          <p className={headCls}>Reach us</p>
          <ul className="mt-4 space-y-3 text-[13.5px]">
            <li className="flex gap-2.5">
              <MapPin size={15} className="mt-0.5 flex-shrink-0 text-primary-bright" />
              <span>{formatAddress()}</span>
            </li>
            <li className="flex gap-2.5">
              <Phone size={15} className="mt-0.5 flex-shrink-0 text-primary-bright" />
              <span>{COMPANY.supportPhone}</span>
            </li>
            <li className="flex gap-2.5">
              <Mail size={15} className="mt-0.5 flex-shrink-0 text-primary-bright" />
              <a href={`mailto:${COMPANY.supportEmail}`} className="transition-colors hover:text-white">
                {COMPANY.supportEmail}
              </a>
            </li>
          </ul>
        </address>
      </div>

      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 text-[12px] text-slate-400 sm:px-6 md:flex-row md:items-center md:justify-between">
          <p>
            &copy; {new Date().getFullYear()} {COMPANY.legalName}. All rights reserved.
          </p>
          <p>Ocar is a technology platform. Rides are provided by independent, verified drivers.</p>
        </div>
      </div>
    </footer>
  )
}
