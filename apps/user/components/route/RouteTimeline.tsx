'use client'

import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { Plus, X, ArrowUpDown, ArrowRight, MapPin, Check } from 'lucide-react'

// Shared multi-stop itinerary spine. One component for booking (editable),
// select-ride (editable, compact) and tracking (read-only, live states).
// Design: docs/MULTI_STOP_UI_REDESIGN_PLAN.md — connected-node timeline,
// shape-coded endpoints, violet numbered stop chips, threaded line, no
// left-stripe accents, restrained ease-out motion.

const EASE = [0.22, 1, 0.36, 1] as const

export type StopState = 'pending' | 'reached' | 'skipped'

export type TimelineNode =
  | { kind: 'origin';      label?: string; address: string }
  | { kind: 'stop';        key?: string; address: string; state?: StopState; onRemove?: () => void; onSwap?: () => void }
  | { kind: 'destination'; label?: string; address?: string | null; placeholder?: string; onTap?: () => void }
  | { kind: 'add';         label?: string; hint?: string; onTap: () => void }

const OVERLINE = 'text-[10px] font-semibold uppercase tracking-wide'
const ADDRESS  = 'text-[13px] font-semibold truncate mt-0.5'

function OriginGlyph() {
  // Emerald = pickup, matching the app's established origin cue (/search card).
  return <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: '#10B981' }} />
}
function DestinationGlyph({ set }: { set: boolean }) {
  return <span className="w-3 h-3 flex-shrink-0" style={{ background: set ? '#4F46E5' : '#CBD5E1', borderRadius: 3 }} />
}
function StopGlyph({ n, state }: { n: number; state: StopState }) {
  if (state === 'reached') {
    return (
      <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#10B981' }}>
        <Check size={12} strokeWidth={3} color="#fff" />
      </span>
    )
  }
  if (state === 'skipped') {
    return (
      <span className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#F1F5F9' }}>
        <X size={12} strokeWidth={3} style={{ color: '#94A3B8' }} />
      </span>
    )
  }
  return (
    <span
      className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[11px] font-bold"
      style={{ background: '#EDE9FE', color: '#7C3AED' }}
    >
      {n}
    </span>
  )
}

// A row's left rail: the threaded line (halves hidden at the ends) + the glyph.
function Rail({ isFirst, isLast, children }: { isFirst: boolean; isLast: boolean; children: React.ReactNode }) {
  return (
    <span className="relative w-6 flex-shrink-0 flex items-center justify-center self-stretch">
      {!isFirst && <span className="absolute top-0 h-1/2 w-0.5" style={{ background: '#C7D2FE' }} />}
      {!isLast &&  <span className="absolute bottom-0 h-1/2 w-0.5" style={{ background: '#C7D2FE' }} />}
      <span className="relative z-10 flex items-center justify-center">{children}</span>
    </span>
  )
}

export default function RouteTimeline({ nodes, className }: { nodes: TimelineNode[]; className?: string }) {
  // Reduced motion: swap the height/scale row transitions for a plain crossfade.
  const reduce = useReducedMotion()

  // Auto-number stops by their order among stop-kind nodes.
  let stopCounter = 0
  const numbered = nodes.map(node => (node.kind === 'stop' ? { node, n: ++stopCounter } : { node, n: 0 }))

  return (
    <div
      className={`rounded-2xl overflow-hidden bg-white ${className ?? ''}`}
      style={{ border: '1px solid #E8EEFF' }}
    >
      <AnimatePresence initial={false}>
        {numbered.map(({ node, n }, i) => {
          const isFirst = i === 0
          const isLast  = i === numbered.length - 1
          const rowBorder = isLast ? undefined : '1px solid #E8EEFF'

          if (node.kind === 'add') {
            return (
              <motion.button
                key="add"
                type="button"
                onClick={node.onTap}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: EASE }}
                className="w-full flex items-center gap-3 px-4 py-3 text-left transition-opacity active:opacity-60"
                style={{ borderBottom: rowBorder }}
              >
                <Rail isFirst={isFirst} isLast={isLast}>
                  <span
                    className="w-[22px] h-[22px] rounded-full flex items-center justify-center"
                    style={{ border: '1.5px dashed #C7D2FE' }}
                  >
                    <Plus size={12} strokeWidth={2.4} style={{ color: '#4F46E5' }} />
                  </span>
                </Rail>
                <span className="text-[13px] font-semibold" style={{ color: '#4F46E5' }}>{node.label ?? 'Add a stop'}</span>
                {node.hint && <span className="ml-auto text-[11px] font-medium" style={{ color: '#94A3B8' }}>{node.hint}</span>}
              </motion.button>
            )
          }

          const glyph =
            node.kind === 'origin'      ? <OriginGlyph /> :
            node.kind === 'destination' ? <DestinationGlyph set={!!node.address} /> :
            <StopGlyph n={n} state={node.state ?? 'pending'} />

          const overline =
            node.kind === 'origin'      ? (node.label ?? 'From') :
            node.kind === 'destination' ? (node.label ?? 'To') :
            `Stop ${n}`

          const skipped = node.kind === 'stop' && node.state === 'skipped'
          const body = (
            <span className="flex items-center gap-3 px-4 py-3.5">
              <Rail isFirst={isFirst} isLast={isLast}>{glyph}</Rail>
              <span className="flex-1 min-w-0">
                <span className={`block ${OVERLINE}`} style={{ color: '#94A3B8' }}>{overline}</span>
                {node.kind === 'destination' && !node.address ? (
                  <span className="block text-[13px] mt-0.5" style={{ color: '#94A3B8' }}>{node.placeholder ?? 'Where are you going?'}</span>
                ) : (
                  <span
                    className={`block ${ADDRESS}`}
                    style={{
                      color: skipped ? '#94A3B8' : '#0F172A',
                      textDecoration: skipped ? 'line-through' : undefined,
                    }}
                  >
                    {node.address}
                  </span>
                )}
              </span>

              {node.kind === 'stop' && (node.onSwap || node.onRemove) && node.state !== 'reached' && node.state !== 'skipped' && (
                <span className="flex items-center gap-0.5 flex-shrink-0">
                  {node.onSwap && (
                    <motion.button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); node.onSwap!() }}
                      aria-label={`Swap stop ${n} with the next`}
                      whileTap={{ scale: 0.9 }}
                      className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity active:opacity-60"
                    >
                      <ArrowUpDown size={14} strokeWidth={2} style={{ color: '#94A3B8' }} />
                    </motion.button>
                  )}
                  {node.onRemove && (
                    <motion.button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); node.onRemove!() }}
                      aria-label={`Remove stop ${n}`}
                      whileTap={{ scale: 0.9 }}
                      className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity active:opacity-60"
                    >
                      <X size={14} strokeWidth={2} style={{ color: '#94A3B8' }} />
                    </motion.button>
                  )}
                </span>
              )}
              {node.kind === 'destination' && node.onTap && (
                <ArrowRight size={14} style={{ color: node.address ? '#C7D2FE' : '#4F46E5' }} className="flex-shrink-0" />
              )}
              {node.kind === 'origin' && <MapPin size={13} style={{ color: '#C7D2FE' }} className="flex-shrink-0" />}
            </span>
          )

          const rowMotion = reduce
            ? {
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                exit:    { opacity: 0 },
                transition: { duration: 0.12 },
                style: { overflow: 'hidden' as const, borderBottom: rowBorder },
              }
            : {
                initial: { opacity: 0, height: 0 as number | 'auto' },
                animate: { opacity: 1, height: 'auto' as const },
                exit:    { opacity: 0, height: 0 as number | 'auto' },
                transition: { duration: 0.2, ease: EASE },
                style: { overflow: 'hidden' as const, borderBottom: rowBorder },
                layout: true as const,
              }

          if (node.kind === 'destination' && node.onTap) {
            return (
              <motion.button key="dest" type="button" onClick={node.onTap} className="w-full text-left" {...rowMotion}>
                {body}
              </motion.button>
            )
          }
          return (
            <motion.div key={node.kind === 'stop' ? (node.key ?? `stop-${n}`) : node.kind} {...rowMotion}>
              {body}
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
