'use client'

import { useEffect, useState } from 'react'

export type TocItem = { id: string; label: string }

// Highlights the section being read. Pure enhancement: without JS the links still jump to the anchors.
export function LegalToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string | null>(items[0]?.id ?? null)

  useEffect(() => {
    const targets = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => el !== null)
    if (targets.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const topmost = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (topmost) setActive(topmost.target.id)
      },
      // The band just under the sticky site header, so a section counts as "current" once its heading reaches it.
      { rootMargin: '-96px 0px -70% 0px' },
    )
    targets.forEach((t) => observer.observe(t))
    return () => observer.disconnect()
  }, [items])

  return (
    <nav aria-label="On this page">
      <p className="px-3 text-[13px] font-semibold text-text-primary">On this page</p>
      <ul className="mt-2 space-y-0.5">
        {items.map((item) => {
          const on = item.id === active
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={on ? 'location' : undefined}
                className={`block rounded-lg px-3 py-1.5 text-[13.5px] leading-snug transition-colors duration-150 ${
                  on
                    ? 'font-semibold text-primary-dark'
                    : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                }`}
              >
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
