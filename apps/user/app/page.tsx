import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import {
  ArrowRight,
  Banknote,
  CarFront,
  CreditCard,
  Clock3,
  KeyRound,
  MapPinned,
  PhoneCall,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from 'lucide-react'

import SiteShell from '@/components/site/SiteShell'
import { CITIES_TEXT } from '@/lib/company'

export const metadata: Metadata = {
  title: { absolute: 'Ocar | Intercity cabs in Bhubaneswar, Cuttack and Puri' },
  description:
    'Book intercity cabs across Odisha with verified drivers, fares shown before you book and live trip tracking. One-way, round trip and hourly rentals.',
  alternates: { canonical: '/' },
}

const FAQ = [
  {
    q: 'How is my fare calculated?',
    a: 'Fares depend on distance, travel time and the vehicle type you pick. You see the estimate before you confirm. It can change if your route or stops change, or during periods of high demand, and the final fare is shown at the end of the trip.',
  },
  {
    q: 'How can I pay?',
    a: 'You can pay the driver in cash, pay online with UPI, cards or net banking through our RBI-authorised payment gateway partners, or use your Ocar wallet balance.',
  },
  {
    q: 'What if my driver cancels?',
    a: 'You are never charged when a driver cancels. We look for another driver automatically, and anything you paid online for that ride is refunded.',
  },
  {
    q: 'Can the driver see my phone number?',
    a: 'No. Calls between you and your driver are connected through a masked number, so neither side sees the other’s real number.',
  },
  {
    q: 'How do refunds work?',
    a: 'Online refunds go back to the original payment method, usually within 5 to 7 business days. Wallet refunds are credited within 24 hours of approval. The full details are in our Refund and Cancellation Policy.',
  },
]

const STEPS = [
  {
    Icon: MapPinned,
    title: 'Choose your route',
    body: 'Enter pickup and drop, add stops if you need them, and pick a vehicle. The fare is shown before you book.',
  },
  {
    Icon: KeyRound,
    title: 'Meet your driver',
    body: 'A verified driver accepts and you follow them live. Share a 4-digit code at pickup to start the trip.',
  },
  {
    Icon: Wallet,
    title: 'Pay and rate',
    body: 'Pay in cash, online or from your wallet when the trip ends. A receipt and a rating prompt follow.',
  },
]

const SAFETY = [
  {
    Icon: ShieldCheck,
    title: 'Verified drivers',
    body: 'Licence, vehicle registration and insurance are checked before a driver can accept a single ride.',
  },
  {
    Icon: KeyRound,
    title: 'OTP-protected trips',
    body: 'A trip starts and ends only with the right code, so you always ride with the driver you were matched with.',
  },
  {
    Icon: ShieldAlert,
    title: 'SOS in the app',
    body: 'One tap sends your live location to our safety team while a trip is in progress.',
  },
  {
    Icon: PhoneCall,
    title: 'Private calls and chat',
    body: 'Talk to your driver through masked calls and in-app chat. Your number stays hidden.',
  },
]

const HOURLY = ['1 hour', '2 hours', '4 hours', '6 hours', '8 hours', '10 hours']

export default async function RootPage() {
  const cookieStore = await cookies()
  const hasSession = cookieStore.get('ocar_user_session')?.value === '1'
  if (hasSession) redirect('/home')

  return (
    <SiteShell>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 md:pb-24 md:pt-16 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <div className="motion-safe:animate-fade-up">
          <h1 className="font-display text-[40px] font-bold leading-[1.05] tracking-tight text-text-primary sm:text-5xl lg:text-[56px]">
            Intercity cabs,
            <br />
            <span className="text-gradient-primary">priced up front.</span>
          </h1>
          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-text-secondary">
            Book verified drivers between {CITIES_TEXT}. See the
            fare first, track every trip live.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-gradient-primary px-7 text-[15px] font-semibold text-text-inverse shadow-button transition-shadow hover:shadow-glow"
            >
              Book a ride
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/pricing"
              className="inline-flex h-12 items-center justify-center rounded-full border border-border bg-surface px-7 text-[15px] font-semibold text-text-primary transition-colors hover:bg-surface-2"
            >
              See fares
            </Link>
          </div>
        </div>

        <div className="motion-safe:animate-fade-up rounded-3xl border border-border bg-surface p-6 shadow-card sm:p-8">
          <p className="text-[13px] font-semibold text-text-muted">Popular intercity routes</p>
          <ul className="mt-5">
            <li className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-display text-[19px] font-semibold text-text-primary">Bhubaneswar to Cuttack</p>
                <p className="mt-1 text-[13px] text-text-secondary">About 30 km on NH16</p>
              </div>
              <ArrowRight size={18} className="flex-shrink-0 text-primary" />
            </li>
            <li className="flex items-center justify-between gap-4 border-t border-border py-4">
              <div>
                <p className="font-display text-[19px] font-semibold text-text-primary">Bhubaneswar to Puri</p>
                <p className="mt-1 text-[13px] text-text-secondary">About 60 km on the coastal corridor</p>
              </div>
              <ArrowRight size={18} className="flex-shrink-0 text-primary" />
            </li>
            <li className="flex items-center justify-between gap-4 border-t border-border py-4">
              <div>
                <p className="font-display text-[19px] font-semibold text-text-primary">Cuttack to Puri</p>
                <p className="mt-1 text-[13px] text-text-secondary">Or any pickup and drop in between</p>
              </div>
              <ArrowRight size={18} className="flex-shrink-0 text-primary" />
            </li>
          </ul>
        </div>
      </section>

      {/* Services */}
      <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 md:pb-24">
        <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
          One app, three ways to ride
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <div className="rounded-3xl bg-gradient-hero p-7 text-text-inverse md:col-span-2 md:p-9">
            <CarFront size={26} className="text-primary-light" />
            <h3 className="mt-5 font-display text-2xl font-bold">One-way trips</h3>
            <p className="mt-2 max-w-md text-[14.5px] leading-relaxed text-slate-300">
              Point to point between cities, charged by the kilometre. Add stops on the way and the fare follows
              the real route.
            </p>
          </div>
          <div className="rounded-3xl border border-border bg-surface p-7 md:p-9">
            <Repeat size={26} className="text-primary" />
            <h3 className="mt-5 font-display text-2xl font-bold text-text-primary">Round trips</h3>
            <p className="mt-2 text-[14.5px] leading-relaxed text-text-secondary">
              Go and come back with the same driver, with waiting time built into the fare.
            </p>
          </div>
          <div className="rounded-3xl bg-primary-subtle p-7 md:col-span-3 md:p-9">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="max-w-xl">
                <Clock3 size={26} className="text-primary-dark" />
                <h3 className="mt-5 font-display text-2xl font-bold text-text-primary">Hourly rentals</h3>
                <p className="mt-2 text-[14.5px] leading-relaxed text-text-secondary">
                  Keep a cab and driver for the day for errands, meetings or sightseeing. Pick a package and pay a
                  fixed fare for the hours and kilometres included.
                </p>
              </div>
              <ul className="flex flex-wrap gap-2 md:max-w-xs md:justify-end">
                {HOURLY.map((h) => (
                  <li
                    key={h}
                    className="rounded-full bg-surface px-4 py-2 text-[13px] font-semibold text-primary-dark"
                  >
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
              From request to arrival
            </h2>
            <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-text-secondary">
              No calling around for rates and no haggling. What you see when you book is what you pay for.
            </p>
          </div>
          <ol>
            {STEPS.map(({ Icon, title, body }, i) => (
              <li key={title} className={`flex gap-5 py-6 ${i > 0 ? 'border-t border-border' : ''}`}>
                <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-primary-subtle">
                  <Icon size={20} className="text-primary-dark" />
                </span>
                <div>
                  <h3 className="font-display text-[19px] font-semibold text-text-primary">{title}</h3>
                  <p className="mt-1.5 max-w-lg text-[14.5px] leading-relaxed text-text-secondary">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Safety */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
          Built around trip safety
        </h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-text-secondary">
          Every trip is tracked from pickup to drop, and every driver is checked before they go online.
        </p>
        <div className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
          {SAFETY.map(({ Icon, title, body }) => (
            <div key={title} className="flex gap-4 border-t border-border pt-6">
              <Icon size={22} className="mt-0.5 flex-shrink-0 text-primary" />
              <div>
                <h3 className="font-display text-[18px] font-semibold text-text-primary">{title}</h3>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-text-secondary">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary md:text-4xl">
              Common questions
            </h2>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13.5px] text-text-secondary">
              <span className="inline-flex items-center gap-2">
                <Banknote size={16} className="text-primary" /> Cash
              </span>
              <span className="inline-flex items-center gap-2">
                <CreditCard size={16} className="text-primary" /> UPI and cards
              </span>
              <span className="inline-flex items-center gap-2">
                <Wallet size={16} className="text-primary" /> Ocar wallet
              </span>
            </div>
          </div>
          <div className="divide-y divide-border rounded-3xl border border-border bg-background">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-6 py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span
                    aria-hidden
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary-subtle text-[17px] leading-none text-primary-dark transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-xl text-[14.5px] leading-relaxed text-text-secondary">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <div className="flex flex-col items-start justify-between gap-6 rounded-3xl bg-gradient-hero p-8 md:flex-row md:items-center md:p-12">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight text-text-inverse">
              Your next trip is a few minutes away
            </h2>
            <p className="mt-2 text-[15px] text-slate-300">Sign in with your phone number to book.</p>
          </div>
          <Link
            href="/login"
            className="inline-flex h-12 flex-shrink-0 items-center justify-center gap-2 rounded-full bg-surface px-7 text-[15px] font-semibold text-text-primary transition-transform hover:-translate-y-0.5"
          >
            Book a ride
            <ArrowRight size={16} />
          </Link>
        </div>
      </section>
    </SiteShell>
  )
}
