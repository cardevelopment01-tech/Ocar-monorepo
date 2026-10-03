'use client'

import { useState } from 'react'
import Link from 'next/link'
import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, ArrowUpDown, ShieldCheck, Tag } from 'lucide-react'

const CITIES = ['Bhubaneswar', 'Cuttack', 'Puri'] as const
type City = (typeof CITIES)[number]

const TYPES = ['One-way', 'Round trip', 'Hourly'] as const

// Approximate road distances, matching the copy used elsewhere on the site.
const KM: Record<string, number> = {
  'Bhubaneswar-Cuttack': 30,
  'Bhubaneswar-Puri': 60,
  'Cuttack-Puri': 85,
}
const km = (a: City, b: City) => KM[`${a}-${b}`] ?? KM[`${b}-${a}`]

const ROUTE = 'M90 90 C 160 100, 170 190, 230 190 S 330 290, 370 330'

function RouteMap() {
  const reduce = useReducedMotion()
  return (
    <div className="relative mx-auto aspect-[460/420] w-full max-w-[460px]">
      <svg viewBox="0 0 460 420" className="h-full w-full" role="img" aria-label="Route from Cuttack through Bhubaneswar to Puri">
        <defs>
          <linearGradient id="route-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22B8C9" />
            <stop offset="1" stopColor="#E869B3" />
          </linearGradient>
        </defs>
        {/* faint "map" grid */}
        <g stroke="rgba(255,255,255,0.06)" strokeWidth="1">
          {Array.from({ length: 9 }).map((_, i) => (
            <line key={`v${i}`} x1={i * 57} y1="0" x2={i * 57} y2="420" />
          ))}
          {Array.from({ length: 8 }).map((_, i) => (
            <line key={`h${i}`} x1="0" y1={i * 60} x2="460" y2={i * 60} />
          ))}
        </g>
        <path d={ROUTE} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="10" strokeLinecap="round" />
        <motion.path
          d={ROUTE}
          fill="none"
          stroke="url(#route-g)"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray="1 10"
          initial={reduce ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.8, ease: 'easeInOut', delay: 0.3 }}
        />
        {[
          { x: 90, y: 90, n: 'Cuttack', dx: 16, dy: -14 },
          { x: 230, y: 190, n: 'Bhubaneswar', dx: 16, dy: -14 },
          { x: 370, y: 330, n: 'Puri', dx: -16, dy: 30, end: true },
        ].map((c) => (
          <g key={c.n}>
            <circle cx={c.x} cy={c.y} r="16" fill="rgba(34,184,201,0.18)" className="motion-safe:animate-pulse-soft" />
            <circle cx={c.x} cy={c.y} r="7" fill="#fff" stroke="url(#route-g)" strokeWidth="3" />
            <text
              x={c.x + c.dx}
              y={c.y + c.dy}
              textAnchor={c.end ? 'end' : 'start'}
              fill="#fff"
              fontSize="15"
              fontWeight="600"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {c.n}
            </text>
          </g>
        ))}
        {!reduce && (
          <g>
            <circle r="9" fill="#fff" />
            <circle r="5" fill="#DC3E93" />
            <animateMotion dur="9s" repeatCount="indefinite" keyPoints="0;1;0" keyTimes="0;0.5;1" calcMode="linear" path={ROUTE} />
          </g>
        )}
      </svg>

      <div className="float-y absolute right-0 top-[8%] hidden items-center gap-2 rounded-2xl bg-white/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-white ring-1 ring-white/15 backdrop-blur sm:flex">
        <Tag size={14} className="text-primary-bright" /> Fare shown before you book
      </div>
      <div
        className="float-y absolute bottom-[6%] left-0 hidden items-center gap-2 rounded-2xl bg-white/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-white ring-1 ring-white/15 backdrop-blur sm:flex"
        style={{ '--d': '-2.5s' } as React.CSSProperties}
      >
        <ShieldCheck size={14} className="text-primary-bright" /> Verified drivers only
      </div>
    </div>
  )
}

function Select({ label, value, onChange, dot }: { label: string; value: City; onChange: (c: City) => void; dot: string }) {
  return (
    <label className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 ring-1 ring-border transition-shadow focus-within:ring-2 focus-within:ring-primary">
      <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${dot}`} aria-hidden />
      <span className="flex-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as City)}
          className="w-full cursor-pointer appearance-none bg-transparent pr-12 font-display text-[17px] font-semibold text-text-primary focus:outline-none"
        >
          {CITIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </span>
    </label>
  )
}

function Widget() {
  const [from, setFrom] = useState<City>('Bhubaneswar')
  const [to, setTo] = useState<City>('Cuttack')
  const [type, setType] = useState<(typeof TYPES)[number]>('One-way')

  const pick = (set: (c: City) => void, other: City, setOther: (c: City) => void) => (c: City) => {
    set(c)
    if (c === other) setOther(CITIES.find((x) => x !== c)!)
  }

  return (
    <div className="w-full max-w-md rounded-3xl bg-surface p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.5)] sm:p-5">
      <div role="tablist" aria-label="Ride type" className="grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1">
        {TYPES.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={type === t}
            onClick={() => setType(t)}
            className={`relative min-h-11 rounded-full py-2.5 text-[13px] font-semibold transition-colors active:scale-[0.97] ${
              type === t ? 'text-text-inverse' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {type === t && (
              <motion.span layoutId="hero-tab" className="absolute inset-0 rounded-full bg-gradient-primary shadow-button" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
            )}
            <span className="relative">{t}</span>
          </button>
        ))}
      </div>

      <div className="relative mt-3 space-y-2">
        <Select label="Pickup" value={from} onChange={pick(setFrom, to, setTo)} dot="bg-primary" />
        <Select label="Drop" value={to} onChange={pick(setTo, from, setFrom)} dot="bg-accent" />
        <button
          type="button"
          aria-label="Swap pickup and drop"
          onClick={() => {
            setFrom(to)
            setTo(from)
          }}
          className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-primary-dark shadow-float ring-1 ring-border transition-transform hover:rotate-180 active:scale-90"
        >
          <ArrowUpDown size={16} />
        </button>
      </div>

      <p className="mt-3 px-1 text-[13px] text-text-secondary">
        About <span className="font-semibold text-text-primary">{km(from, to)} km</span> · fare shown before you confirm
      </p>

      <Link
        href="/login"
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-primary py-4 text-[15px] font-semibold text-text-inverse shadow-button transition-[transform,box-shadow] duration-150 hover:shadow-glow active:scale-[0.97]"
      >
        See fare and book
        <ArrowRight size={16} />
      </Link>
    </div>
  )
}

export default function Hero({ cities }: { cities: string }) {
  const rise = (d: number) => ({ style: { '--d': `${d}s` } as React.CSSProperties })

  return (
    <section className="mx-auto max-w-6xl px-3 pt-3 sm:px-6 sm:pt-4">
      <div className="relative overflow-hidden rounded-[28px] bg-gradient-hero sm:rounded-[40px]">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-primary/30 blur-[110px]" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-accent/25 blur-[120px]" />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35] [background-image:radial-gradient(rgba(255,255,255,0.12)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        />

        <div className="relative grid items-center gap-10 px-5 py-12 sm:px-10 md:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:px-14 lg:py-20">
          <div>
            <span
              {...rise(0)}
              className="hero-rise inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[12.5px] font-semibold text-white ring-1 ring-white/15"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-primary-bright opacity-70 motion-safe:animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-bright" />
              </span>
              Bhubaneswar · Cuttack · Puri
            </span>
            <h1
              {...rise(0.08)}
              className="hero-rise mt-5 font-display text-[42px] font-bold leading-[1.02] tracking-tight text-white sm:text-6xl lg:text-[68px]"
            >
              Intercity cabs,
              <br />
              <span className="bg-gradient-primary-soft bg-clip-text text-transparent">priced up front.</span>
            </h1>
            <p {...rise(0.16)} className="hero-rise mt-5 max-w-md text-[16px] leading-relaxed text-slate-300">
              Book verified drivers between {cities}. See the fare first, track every trip live.
            </p>
            <div {...rise(0.26)} className="hero-rise mt-8">
              <Widget />
            </div>
          </div>

          <div {...rise(0.2)} className="hero-rise mx-auto w-full max-w-[320px] sm:max-w-none">
            <RouteMap />
          </div>
        </div>
      </div>
    </section>
  )
}
