'use client'

import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Check, KeyRound, MapPinned, Wallet } from 'lucide-react'

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

// Illustrative app screens (placeholder data, not real fares).
function Screen({ i }: { i: number }) {
  if (i === 0)
    return (
      <div className="space-y-3">
        <p className="font-display text-[15px] font-bold text-text-primary">Where to?</p>
        <div className="space-y-2 rounded-2xl bg-surface-2 p-3 text-[12.5px] font-semibold text-text-primary">
          <p className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary" /> Bhubaneswar</p>
          <p className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-accent" /> Puri</p>
        </div>
        {['Hatchback', 'Sedan', 'SUV'].map((v, k) => (
          <div key={v} className={`flex items-center justify-between rounded-xl px-3 py-2.5 text-[12.5px] font-semibold ${k === 1 ? 'bg-primary-subtle text-primary-dark ring-1 ring-primary' : 'bg-surface-2 text-text-secondary'}`}>
            {v}
            <span className="h-2 w-14 rounded-full bg-current opacity-25" />
          </div>
        ))}
      </div>
    )
  if (i === 1)
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-primary text-lg font-bold text-white">D</div>
        <div>
          <p className="font-display text-[15px] font-bold text-text-primary">Your driver is on the way</p>
          <p className="mt-0.5 text-[12px] text-text-secondary">Verified · Live tracking</p>
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Share this code at pickup</p>
        <div className="flex justify-center gap-2">
          {['4', '8', '2', '1'].map((d, k) => (
            <span key={k} className="flex h-11 w-9 items-center justify-center rounded-xl bg-surface-2 font-display text-lg font-bold text-text-primary ring-1 ring-border">{d}</span>
          ))}
        </div>
      </div>
    )
  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-money-light text-money">
        <Check size={26} strokeWidth={3} />
      </div>
      <p className="font-display text-[15px] font-bold text-text-primary">Trip complete</p>
      <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
        <span className="block h-2 w-full rounded-full bg-border" />
        <span className="block h-2 w-2/3 rounded-full bg-border" />
      </div>
      <div className="flex justify-center gap-1 text-xl text-status-warning" aria-label="Rating prompt">★★★★★</div>
    </div>
  )
}

// Desktop: a sticky phone swaps screens as you scroll the steps. Mobile: no sticky
// phone (it would eat the viewport); every step carries its own screen inline.
export default function HowItWorks() {
  const [active, setActive] = useState(0)
  const reduce = useReducedMotion()

  return (
    <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
      <div className="lg:sticky lg:top-28">
        <h2 className="font-display text-3xl font-bold tracking-tight text-text-primary md:text-5xl">From request to arrival</h2>
        <p className="mt-4 max-w-sm text-[15px] leading-relaxed text-text-secondary">
          No calling around for rates and no haggling. What you see when you book is what you pay for.
        </p>

        <div aria-hidden className="relative mt-10 hidden w-[250px] rounded-[38px] bg-gradient-hero p-2.5 shadow-[0_30px_60px_-20px_rgba(15,15,35,0.55)] lg:block">
          <div className="absolute left-1/2 top-4 h-1.5 w-16 -translate-x-1/2 rounded-full bg-black/60" />
          <div className="h-[340px] overflow-hidden rounded-[30px] bg-surface px-4 pb-4 pt-9">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={reduce ? false : { opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -14 }}
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              >
                <Screen i={active} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <ol className="space-y-4 lg:pt-6">
        {STEPS.map(({ Icon, title, body }, i) => {
          const on = active === i
          return (
            <motion.li
              key={title}
              onViewportEnter={() => setActive(i)}
              viewport={{ amount: 0.9, margin: '-30% 0px -30% 0px' }}
              className={`rounded-3xl p-5 ring-1 transition-[background-color,box-shadow,opacity] duration-300 sm:p-6 lg:min-h-[180px] ${
                on ? 'bg-surface shadow-card ring-primary/40' : 'ring-border lg:opacity-60 lg:ring-transparent'
              }`}
            >
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-current={on ? 'step' : undefined}
                className="flex w-full gap-4 text-left sm:gap-5"
              >
                <span className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl transition-colors ${on ? 'bg-gradient-primary text-white shadow-button' : 'bg-primary-subtle text-primary-dark'}`}>
                  <Icon size={22} />
                </span>
                <span>
                  <span className="text-[12px] font-semibold uppercase tracking-wider text-text-muted">Step {i + 1}</span>
                  <span className="mt-0.5 block font-display text-[21px] font-semibold text-text-primary">{title}</span>
                  <span className="mt-2 block max-w-md text-[14.5px] leading-relaxed text-text-secondary">{body}</span>
                </span>
              </button>
              <div aria-hidden className="mt-5 rounded-2xl bg-surface-2 p-4 ring-1 ring-border lg:hidden">
                <Screen i={i} />
              </div>
            </motion.li>
          )
        })}
      </ol>
    </div>
  )
}
