'use client'

import { Printer } from 'lucide-react'

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-surface px-4 text-[14px] font-semibold text-text-primary transition-colors hover:bg-surface-2 active:scale-[0.98] print:hidden"
    >
      <Printer aria-hidden className="h-4 w-4" />
      Print or save as PDF
    </button>
  )
}
