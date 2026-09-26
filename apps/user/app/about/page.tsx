import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, Building2, MapPin } from 'lucide-react'

import SiteShell from '@/components/site/SiteShell'
import { CITIES_TEXT, COMPANY, formatAddress } from '@/lib/company'

export const metadata: Metadata = {
  title: 'About Ocar',
  description:
    'Ocar is a technology platform connecting riders with independent, verified drivers for intercity cab trips across Bhubaneswar, Cuttack and Puri, Odisha.',
  alternates: { canonical: '/about' },
}

const CHECKS = [
  'Driving licence',
  'Vehicle registration certificate',
  'Vehicle insurance',
  'Live selfie at sign-up',
  'Periodic photo re-verification',
]

export default function AboutPage() {
  return (
    <SiteShell>
      <div className="border-b border-border bg-surface">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-20">
          <h1 className="max-w-3xl font-display text-4xl font-bold leading-[1.08] tracking-tight text-text-primary md:text-5xl">
            Reliable intercity travel for Odisha, without the guesswork
          </h1>
          <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-text-secondary">
            Ocar is a cab booking platform for the Bhubaneswar, Cuttack and Puri corridor. We built it so anyone
            can book a trip knowing the fare, the driver and the route before they leave.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-6xl space-y-16 px-4 py-12 sm:px-6 md:space-y-24 md:py-20">
        <section className="grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
          <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary">What Ocar does</h2>
          <div className="space-y-4 text-[15.5px] leading-relaxed text-text-secondary">
            <p>
              Ocar is a technology platform, not a taxi operator. It connects riders with independent drivers who
              own and operate their vehicles, and it operates as an intermediary under the Motor Vehicle
              Aggregator Guidelines, 2020.
            </p>
            <p>
              Riders can book one-way trips, round trips and hourly rentals in {CITIES_TEXT}.
              Fares are calculated from distance, time and vehicle type and shown before booking. Every trip is
              tracked live, protected by start and end codes, and backed by an SOS option and in-app support.
            </p>
          </div>
        </section>

        <section className="grid gap-8 rounded-3xl bg-gradient-hero p-8 text-text-inverse md:grid-cols-[0.8fr_1.2fr] md:gap-16 md:p-12">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight">How we vet drivers</h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-slate-300">
              A driver cannot accept rides until our team has reviewed and approved every document below.
            </p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {CHECKS.map((c) => (
              <li key={c} className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-3.5 text-[14.5px] font-medium">
                <BadgeCheck size={18} className="flex-shrink-0 text-primary-light" />
                {c}
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
          <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary">Where we operate</h2>
          <div>
            <ul className="flex flex-wrap gap-3">
              {COMPANY.serviceCities.map((c) => (
                <li
                  key={c}
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-5 py-2.5 text-[14.5px] font-semibold text-text-primary"
                >
                  <MapPin size={15} className="text-primary" />
                  {c}
                </li>
              ))}
            </ul>
            <p className="mt-4 max-w-xl text-[14.5px] leading-relaxed text-text-secondary">
              We serve pickups and drops between these cities and within their service areas, and we add new
              areas as our driver network grows.
            </p>
          </div>
        </section>

        <section className="grid gap-8 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
          <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary">Business details</h2>
          <div className="rounded-3xl border border-border bg-surface p-7">
            <div className="flex gap-4">
              <Building2 size={22} className="mt-0.5 flex-shrink-0 text-primary" />
              <dl className="space-y-4 text-[14.5px]">
                <div>
                  <dt className="text-[12.5px] font-semibold text-text-muted">Registered name</dt>
                  <dd className="mt-0.5 font-semibold text-text-primary">{COMPANY.legalName}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] font-semibold text-text-muted">Registered office</dt>
                  <dd className="mt-0.5 text-text-secondary">{formatAddress()}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] font-semibold text-text-muted">GSTIN</dt>
                  <dd className="mt-0.5 text-text-secondary">{COMPANY.gstin}</dd>
                </div>
                <div>
                  <dt className="text-[12.5px] font-semibold text-text-muted">Support</dt>
                  <dd className="mt-0.5 text-text-secondary">
                    <a href={`mailto:${COMPANY.supportEmail}`} className="font-semibold text-primary-dark">
                      {COMPANY.supportEmail}
                    </a>
                    , or see our{' '}
                    <Link href="/contact" className="font-semibold text-primary-dark underline">
                      Contact page
                    </Link>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>
      </div>
    </SiteShell>
  )
}
