'use client'

import Link from 'next/link'
import { useEffect, useRef } from 'react'

import { POLICIES } from './policies'

// Sideways-scrolling chips on a phone, a vertical list from lg up. On load the row scrolls so the current
// policy is visible, otherwise a reader on the fourth policy would see none of them selected.
export function PolicySwitcher({ currentHref }: { currentHref: string }) {
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!list || !active || list.scrollWidth <= list.clientWidth) return
    list.scrollLeft = Math.max(0, active.offsetLeft - 16)
  }, [currentHref])

  return (
    <nav aria-label="Policies">
      <p className="text-[13px] font-semibold text-text-primary lg:px-3">Policies</p>
      <ul
        ref={listRef}
        className="relative -mr-4 mt-2 flex gap-1 overflow-x-auto pb-1 pr-8 [mask-image:linear-gradient(to_right,black_calc(100%-3rem),transparent)] sm:-mr-6 lg:mr-0 lg:flex-col lg:overflow-visible lg:pb-0 lg:pr-0 lg:[mask-image:none]"
      >
        {POLICIES.map((p) => {
          const active = p.href === currentHref
          return (
            <li key={p.href} className="flex-shrink-0">
              <Link
                href={p.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 text-[14px] transition-colors duration-150 lg:min-h-0 lg:whitespace-normal lg:py-2 ${
                  active
                    ? 'bg-primary-subtle font-semibold text-primary-dark'
                    : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                }`}
              >
                {p.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
