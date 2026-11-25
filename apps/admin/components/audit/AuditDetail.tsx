'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Copy, ExternalLink, Filter, ShieldAlert } from 'lucide-react'
import type { AuditLogEntry } from '@/lib/audit-log-api'
import {
  describeClient, diffRows, formatValue, humanizeAction, initials, isRiskyAction, outcomeLabel, outcomeTone, targetHref,
} from '@/lib/audit-log-model'

export function OutcomePill({ outcome }: { outcome: AuditLogEntry['outcome'] }) {
  return <span className={`pill pill-${outcomeTone(outcome)} text-[10px]`}>{outcomeLabel(outcome)}</span>
}

export function Actor({ entry, size = 'sm' }: { entry: AuditLogEntry; size?: 'sm' | 'md' }) {
  const system = !entry.admin_id
  const label = system ? (entry.source === 'auth' ? 'Unknown sign-in' : 'System') : (entry.admin_email ?? `Admin #${entry.admin_id}`)
  const box = size === 'md' ? 'h-10 w-10 text-sm' : 'h-8 w-8 text-[11px]'
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span className={`${box} shrink-0 rounded-full bg-primary/10 text-primary font-semibold flex items-center justify-center`} aria-hidden>
        {system ? '··' : initials(entry.admin_email)}
      </span>
      <span className="min-w-0">
        <span className={`block truncate text-sm font-medium ${system ? 'italic text-text-muted' : 'text-text-primary'}`}>{label}</span>
        {entry.admin_role && <span className="block text-xs text-text-muted capitalize">{entry.admin_role.replace('_', ' ')}</span>}
      </span>
    </div>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) }).catch(() => undefined) }}
      className="ml-1.5 text-text-muted hover:text-text-primary transition-colors"
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text-primary break-words">{children}</dd>
    </div>
  )
}

interface Props {
  entry: AuditLogEntry
  onFilter: (patch: { q?: string; targetTable?: string; targetId?: string; adminId?: string }) => void
}

export default function AuditDetail({ entry, onFilter }: Props) {
  const [raw, setRaw] = useState(false)
  const diffs = diffRows(entry.before_state, entry.after_state)
  const href = targetHref(entry.target_table, entry.target_id)
  const request = (entry.after_state?.['request'] ?? null) as Record<string, unknown> | null
  const isHttp = entry.source === 'http'

  return (
    <div className="p-6 space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <OutcomePill outcome={entry.outcome} />
          {isRiskyAction(entry.action) && (
            <span className="pill pill-warning text-[10px] inline-flex items-center gap-1"><ShieldAlert size={10} /> Sensitive</span>
          )}
          <code className="text-[11px] font-mono text-text-muted">{entry.action}</code>
        </div>
        <h3 className="font-display text-lg font-semibold text-text-primary">{entry.summary ?? humanizeAction(entry.action)}</h3>
        <p className="text-xs text-text-muted">
          {new Date(entry.occurred_at).toLocaleString('en-IN', { dateStyle: 'full', timeStyle: 'medium' })}
        </p>
      </header>

      <Actor entry={entry} size="md" />

      {entry.reason && (
        <section className="rounded-xl border border-border-light bg-surface-2 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-text-muted">Reason given</p>
          <p className="mt-1 text-sm text-text-primary">{entry.reason}</p>
        </section>
      )}

      <section>
        <h4 className="text-xs font-semibold text-text-secondary mb-2">What changed</h4>
        {diffs.length === 0 ? (
          <p className="text-sm text-text-muted">
            {isHttp ? 'This action was captured from the request itself, so there is no before/after snapshot.' : 'No field-level changes were recorded for this action.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border-light">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-text-muted">
                <tr><th className="px-3 py-2 text-left font-medium">Field</th><th className="px-3 py-2 text-left font-medium">Before</th><th className="px-3 py-2 text-left font-medium">After</th></tr>
              </thead>
              <tbody>
                {diffs.map(d => (
                  <tr key={d.field} className="border-t border-border-light align-top">
                    <td className="px-3 py-2 font-mono text-text-secondary">{d.field}</td>
                    <td className={`px-3 py-2 font-mono break-all ${d.kind === 'added' ? 'text-text-muted' : 'text-danger line-through decoration-danger/40'}`}>{formatValue(d.before)}</td>
                    <td className={`px-3 py-2 font-mono break-all ${d.kind === 'removed' ? 'text-text-muted' : 'text-success'}`}>{formatValue(d.after)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isHttp && request && Object.keys(request).length > 0 && (
          <p className="mt-2 text-xs text-text-muted">Request details are in the raw record below.</p>
        )}
      </section>

      <section>
        <h4 className="text-xs font-semibold text-text-secondary mb-2">Where it came from</h4>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
          <Meta label="Target">
            {entry.target_id ? `${entry.target_table} #${entry.target_id}` : entry.target_table}
            {href && <Link href={href} className="ml-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">Open <ExternalLink size={11} /></Link>}
          </Meta>
          <Meta label="IP address"><span className="font-mono text-xs">{entry.ip_address ?? '—'}</span></Meta>
          <Meta label="Device">{describeClient(entry.user_agent)}</Meta>
          <Meta label="Route">
            {entry.http_method ? <span className="font-mono text-xs">{entry.http_method} {entry.http_path}{entry.http_status ? ` → ${entry.http_status}` : ''}</span> : '—'}
          </Meta>
          <Meta label="Request ID">
            {entry.request_id ? <><span className="font-mono text-xs">{entry.request_id.slice(0, 13)}…</span><CopyButton value={entry.request_id} label="request ID" /></> : '—'}
          </Meta>
          <Meta label="Integrity">
            {entry.event_hash
              ? <><span className="font-mono text-xs">#{entry.chain_seq} · {entry.event_hash.slice(0, 10)}…</span><CopyButton value={entry.event_hash} label="entry hash" /></>
              : <span className="text-text-muted">Before hash-chaining</span>}
          </Meta>
        </dl>
      </section>

      <section className="flex flex-wrap gap-2">
        {entry.request_id && (
          <button type="button" onClick={() => onFilter({ q: entry.request_id! })} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2 transition-colors">
            <Filter size={12} /> Everything in this request
          </button>
        )}
        {entry.target_id && (
          <button type="button" onClick={() => onFilter({ targetTable: entry.target_table, targetId: entry.target_id! })} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2 transition-colors">
            <Filter size={12} /> History of this {entry.target_table.replace(/s$/, '')}
          </button>
        )}
        {entry.admin_id && (
          <button type="button" onClick={() => onFilter({ adminId: entry.admin_id! })} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2 transition-colors">
            <Filter size={12} /> More by this admin
          </button>
        )}
      </section>

      <section>
        <button type="button" onClick={() => setRaw(r => !r)} className="text-xs font-medium text-primary hover:underline">
          {raw ? 'Hide raw record' : 'Show raw record'}
        </button>
        {raw && (
          <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-surface-2 p-3 text-[11px] font-mono text-text-muted">
            {JSON.stringify({ before: entry.before_state, after: entry.after_state }, null, 2)}
          </pre>
        )}
      </section>
    </div>
  )
}
