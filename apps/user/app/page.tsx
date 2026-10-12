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
  PhoneCall,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  Wallet,
} from 'lucide-react'

import SiteShell from '@/components/site/SiteShell'
import Hero from '@/components/landing/Hero'
import HowItWorks from '@/components/landing/HowItWorks'
import Reveal from '@/components/landing/Reveal'
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

const ROUTES = [
  'Bhubaneswar to Cuttack',
  'Bhubaneswar to Puri',
  'Cuttack to Puri',
  'One-way trips',
  'Round trips',
  'Hourly rentals',
  'Stops along the way',
]

export default async function RootPage() {
  const cookieStore = await cookies()
  const hasSession = cookieStore.get('ocar_user_session')?.value === '1'
  if (hasSession) redirect('/home')

  return (
    <SiteShell>
      <Hero cities={CITIES_TEXT} />

      {/* Routes marquee */}
      <div
        aria-hidden
        className="group mt-8 overflow-hidden border-y border-border bg-surface py-4 [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]"
      >
        <div className="flex w-max gap-3 motion-safe:animate-marquee group-hover:[animation-play-state:paused]">
          {[...ROUTES, ...ROUTES].map((r, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-4 py-2 text-[13.5px] font-semibold text-text-secondary ring-1 ring-border"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-gradient-primary" />
              {r}
            </span>
          ))}
        </div>
      </div>

      {/* Services */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 md:py-24">
        <Reveal>
          <p className="text-[13px] font-semibold uppercase tracking-wider text-primary-dark">Ways to ride</p>
          <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-text-primary md:text-5xl">
            One app, three ways to ride
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Reveal className="md:col-span-2">
            <div className="relative h-full overflow-hidden rounded-3xl bg-gradient-hero p-7 text-text-inverse transition-transform duration-300 motion-safe:hover:-translate-y-1 md:p-10">
              <div aria-hidden className="absolute -right-10 -top-10 h-56 w-56 rounded-full bg-primary/30 blur-[80px]" />
              <svg aria-hidden viewBox="0 0 200 60" className="absolute bottom-6 right-6 hidden w-52 sm:block">
                <defs>
                  <linearGradient id="ow">
                    <stop stopColor="#22B8C9" />
                    <stop offset="1" stopColor="#E869B3" />
                  </linearGradient>
                </defs>
                <path
                  d="M4 50 C 50 50, 60 10, 100 30 S 160 50, 196 10"
                  fill="none"
                  stroke="url(#ow)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray="2 8"
                  className="motion-safe:animate-dash"
                />
              </svg>
              <CarFront size={28} className="relative text-primary-bright" />
              <h3 className="relative mt-6 font-display text-3xl font-bold">One-way trips</h3>
              <p className="relative mt-3 max-w-md text-[15px] leading-relaxed text-slate-300">
                Point to point between cities, charged by the kilometre. Add stops on the way and the fare follows the
                real route.
              </p>
            </div>
          </Reveal>
          <Reveal delay={0.08}>
            <div className="h-full rounded-3xl border border-border bg-surface p-7 transition-[transform,box-shadow] duration-300 hover:shadow-card motion-safe:hover:-translate-y-1 md:p-10">
              <Repeat size={28} className="text-primary" />
              <h3 className="mt-6 font-display text-3xl font-bold text-text-primary">Round trips</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
                Go and come back with the same driver, with waiting time built into the fare.
              </p>
            </div>
          </Reveal>
          <Reveal className="md:col-span-3" delay={0.12}>
            <div className="rounded-3xl bg-primary-subtle p-7 transition-transform duration-300 motion-safe:hover:-translate-y-1 md:p-10">
              <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
                <div className="max-w-xl">
                  <Clock3 size={28} className="text-primary-dark" />
                  <h3 className="mt-6 font-display text-3xl font-bold text-text-primary">Hourly rentals</h3>
                  <p className="mt-3 text-[15px] leading-relaxed text-text-secondary">
                    Keep a cab and driver for the day for errands, meetings or sightseeing. Pick a package and pay a
                    fixed fare for the hours and kilometres included.
                  </p>
                </div>
                <ul className="flex flex-wrap gap-2 md:max-w-xs md:justify-end">
                  {HOURLY.map((h) => (
                    <li
                      key={h}
                      className="rounded-full bg-surface px-4 py-2 text-[13px] font-semibold text-primary-dark shadow-float transition-transform hover:-translate-y-0.5"
                    >
                      {h}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-border bg-surface/60">
        <HowItWorks />
      </section>

      {/* Safety */}
      <section className="mx-auto max-w-6xl px-3 py-16 sm:px-6 md:py-24">
        <div className="relative overflow-hidden rounded-[28px] bg-gradient-hero px-5 py-12 sm:rounded-[40px] sm:px-12 md:py-20">
          <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-80 w-80 rounded-full bg-primary/25 blur-[100px]" />
          <Reveal>
            <h2 className="relative font-display text-3xl font-bold tracking-tight text-white md:text-5xl">
              Built around trip safety
            </h2>
            <p className="relative mt-4 max-w-xl text-[15px] leading-relaxed text-slate-300">
              Every trip is tracked from pickup to drop, and every driver is checked before they go online.
            </p>
          </Reveal>
          <div className="relative mt-10 grid gap-4 md:grid-cols-2">
            {SAFETY.map(({ Icon, title, body }, i) => (
              <Reveal key={title} delay={i * 0.07}>
                <div className="h-full rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/10 backdrop-blur transition-colors duration-300 hover:bg-white/[0.1]">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-primary text-white shadow-button">
                    <Icon size={20} />
                  </span>
                  <h3 className="mt-5 font-display text-[20px] font-semibold text-white">{title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-slate-300">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 sm:px-6 md:pb-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
        <Reveal>
          <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary md:text-5xl">
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
        </Reveal>
        <Reveal delay={0.08}>
          <div className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-surface">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-6 py-5 transition-colors open:bg-primary-subtle/40">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-semibold text-text-primary [&::-webkit-details-marker]:hidden">
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
        </Reveal>
      </section>

      {/* Closing CTA */}
      <section className="mx-auto max-w-6xl px-3 pb-16 sm:px-6 md:pb-24">
        <Reveal>
          <div className="relative overflow-hidden rounded-[28px] bg-gradient-primary p-8 sm:rounded-[40px] md:p-14">
            <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-white/20 blur-[70px]" />
            <div className="relative flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <h2 className="font-display text-3xl font-bold tracking-tight text-white md:text-5xl">
                  Your next trip is a few minutes away
                </h2>
                <p className="mt-3 text-[15px] text-white/80">Sign in with your phone number to book.</p>
              </div>
              <Link
                href="/login"
                className="inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-full bg-surface px-8 py-4 text-[15px] font-semibold text-text-primary shadow-float transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.97]"
              >
                Book a ride
                <ArrowRight size={16} />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </SiteShell>
  )
}
