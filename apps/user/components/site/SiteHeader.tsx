'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Menu, X } from 'lucide-react'

import OcarLogoMark from '@/components/ui/OcarLogoMark'

const LINKS = [
  { href: '/pricing', label: 'Fares' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
]

export default function SiteHeader() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const pathname = usePathname()
  const reduce = useReducedMotion()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-40 border-b backdrop-blur transition-[background-color,box-shadow,border-color] duration-300 ${
        scrolled ? 'border-border bg-surface/90 shadow-float' : 'border-transparent bg-background/70'
      }`}
    >
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between px-4 pt-[env(safe-area-inset-top)] sm:px-6 [@media(orientation:landscape)]:pl-[max(1rem,env(safe-area-inset-left))] [@media(orientation:landscape)]:pr-[max(1rem,env(safe-area-inset-right))]">
        <Link href="/" aria-label="Ocar home" className="flex items-center py-3 pr-3">
          <OcarLogoMark size="sm" />
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`relative rounded-full px-4 py-2.5 text-[14px] font-semibold transition-colors ${
                  active ? 'text-primary-dark' : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-primary-subtle"
                    transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                  />
                )}
                <span className="relative">{l.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden h-10 items-center rounded-full bg-gradient-primary px-5 text-[14px] font-semibold text-text-inverse shadow-button transition-[box-shadow,transform] hover:shadow-glow active:scale-[0.98] sm:inline-flex"
          >
            Book a ride
          </Link>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-text-primary transition-transform active:scale-90 md:hidden"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            aria-label="Mobile"
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="border-t border-border bg-surface px-4 pb-4 pt-2 md:hidden"
          >
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block rounded-xl px-3 py-3.5 text-[15px] font-semibold text-text-primary transition-colors active:bg-surface-2"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="mt-2 flex h-12 items-center justify-center rounded-full bg-gradient-primary text-[15px] font-semibold text-text-inverse shadow-button transition-transform active:scale-[0.98]"
            >
              Book a ride
            </Link>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  )
}
