import type { Metadata } from 'next'
import Link from 'next/link'
import { Clock3, Mail, MapPin, Phone, Scale } from 'lucide-react'

import SiteShell from '@/components/site/SiteShell'
import { COMPANY, formatAddress } from '@/lib/company'

export const metadata: Metadata = {
  title: 'Contact Us',
  description:
    'Contact Ocar support by email or phone, find our registered office address, and reach our Grievance Officer.',
  alternates: { canonical: '/contact' },
}

export default function ContactPage() {
  return (
    <SiteShell>
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-16">
          <h1 className="font-display text-4xl font-bold tracking-tight text-text-primary md:text-5xl">Contact us</h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-text-secondary">
            Questions about a booking, a payment or a refund? Write or call us and a real person will reply.
          </p>
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:py-16 lg:grid-cols-[1.2fr_0.8fr] lg:gap-16">
        <section aria-labelledby="support">
          <h2 id="support" className="font-display text-2xl font-bold tracking-tight text-text-primary">
            Customer support
          </h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2">
            <li className="rounded-3xl border border-border bg-surface p-6">
              <Mail size={22} className="text-primary" />
              <p className="mt-4 text-[12.5px] font-semibold text-text-muted">Email</p>
              <a
                href={`mailto:${COMPANY.supportEmail}`}
                className="mt-1 block break-all font-display text-[17px] font-semibold text-text-primary hover:text-primary-dark"
              >
                {COMPANY.supportEmail}
              </a>
            </li>
            <li className="rounded-3xl border border-border bg-surface p-6">
              <Phone size={22} className="text-primary" />
              <p className="mt-4 text-[12.5px] font-semibold text-text-muted">Phone</p>
              <p className="mt-1 font-display text-[17px] font-semibold text-text-primary">{COMPANY.supportPhone}</p>
            </li>
            <li className="rounded-3xl border border-border bg-surface p-6">
              <Clock3 size={22} className="text-primary" />
              <p className="mt-4 text-[12.5px] font-semibold text-text-muted">Support hours</p>
              <p className="mt-1 font-display text-[17px] font-semibold text-text-primary">{COMPANY.supportHours}</p>
            </li>
            <li className="rounded-3xl border border-border bg-surface p-6">
              <MapPin size={22} className="text-primary" />
              <p className="mt-4 text-[12.5px] font-semibold text-text-muted">Registered office</p>
              <p className="mt-1 text-[15px] font-semibold leading-snug text-text-primary">
                {COMPANY.legalName}
                <span className="mt-1 block font-normal text-text-secondary">{formatAddress()}</span>
              </p>
            </li>
          </ul>

          <p className="mt-6 text-[14.5px] leading-relaxed text-text-secondary">
            For an active ride, use Help &amp; Support inside the app so we can see your trip. For refunds, please
            read our{' '}
            <Link href="/legal/refund-cancellation" className="font-semibold text-primary-dark underline">
              Refund and Cancellation Policy
            </Link>{' '}
            first; it explains what to send us and how long each step takes.
          </p>
        </section>

        <aside className="self-start rounded-3xl bg-primary-subtle p-7 md:p-9">
          <Scale size={22} className="text-primary-dark" />
          <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-text-primary">Grievance Officer</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">
            If your complaint is not resolved by support, write to our Grievance Officer as required under the
            Information Technology Act, 2000.
          </p>
          <dl className="mt-5 space-y-3 text-[14.5px]">
            <div>
              <dt className="text-[12.5px] font-semibold text-text-muted">Name</dt>
              <dd className="font-semibold text-text-primary">{COMPANY.grievanceOfficer.name}</dd>
            </div>
            <div>
              <dt className="text-[12.5px] font-semibold text-text-muted">Email</dt>
              <dd>
                <a
                  href={`mailto:${COMPANY.grievanceOfficer.email}`}
                  className="break-all font-semibold text-primary-dark"
                >
                  {COMPANY.grievanceOfficer.email}
                </a>
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-[13px] text-text-secondary">
            We acknowledge complaints within 48 hours and aim to resolve them within 15 days.
          </p>
        </aside>
      </div>
    </SiteShell>
  )
}
