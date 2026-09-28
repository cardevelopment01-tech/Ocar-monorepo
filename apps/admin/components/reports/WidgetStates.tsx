'use client'
import { motion } from 'framer-motion'
import { AlertCircle, SearchX } from 'lucide-react'
import { MOTION, prefersReducedMotion } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** Wraps a widget so old data dims (never blanks) while a newer request loads, then crossfades. */
export function Refreshable({ refreshing, children, className }: { refreshing: boolean; children: React.ReactNode; className?: string }) {
  const ms = (prefersReducedMotion() ? MOTION.reducedMs : MOTION.crossfadeMs) / 1000
  return (
    <motion.div
      className={className}
      animate={{ opacity: refreshing ? MOTION.dimOpacity : 1 }}
      transition={{ duration: ms, ease: MOTION.ease }}
      aria-busy={refreshing}
    >
      {children}
    </motion.div>
  )
}

export function WidgetSkeleton({ rows = 3, height = 'h-8' }: { rows?: number; height?: string }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className={cn('skeleton rounded', height)} />)}
    </div>
  )
}

/** Error card with Retry. Other widgets keep working; the page never falls back to zeros. */
export function ErrorCard({ message = 'Could not load this section.', onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <AlertCircle size={20} className="text-danger" aria-hidden />
      <p className="text-md text-text-primary">{message}</p>
      <button type="button" onClick={onRetry} className="btn-secondary min-h-[44px]">Retry</button>
    </div>
  )
}

export interface EmptyAction { label: string; onClick: () => void }

/** Why it is empty plus at most one action that fixes the likely cause (design D4). */
export function EmptyState({ message, action }: { message: string; action?: EmptyAction | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <SearchX size={20} className="text-text-muted" aria-hidden />
      <p className="text-md text-text-secondary">{message}</p>
      {action && <button type="button" onClick={action.onClick} className="btn-secondary min-h-[44px]">{action.label}</button>}
    </div>
  )
}

/** A panel with a section heading that states what it shows (App UI rule). */
export function Panel({ title, note, right, children, className }: {
  title: string; note?: string; right?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <section className={cn('admin-card !cursor-default', className)} aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-display font-bold text-text-primary">{title}</h2>
          {note && <p className="text-base text-text-secondary mt-0.5">{note}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}
