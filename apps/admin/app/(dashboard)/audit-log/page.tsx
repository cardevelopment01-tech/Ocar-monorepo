'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw, ScrollText, Search, ShieldAlert, ShieldCheck, ShieldX, X,
} from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import SlideOver from '@/components/ui/SlideOver'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import AuditDetail, { Actor, OutcomePill } from '@/components/audit/AuditDetail'
import { auditLogApi, type AuditFacets, type AuditLogEntry, type ChainVerification } from '@/lib/audit-log-api'
import {
  EMPTY_FILTERS, actionGroup, activeFilterCount, filtersToParams, humanizeAction, isRiskyAction, relativeTime,
  type AuditFilterState, type Outcome,
} from '@/lib/audit-log-model'
import { cn } from '@/lib/utils'

const RANGES: { value: AuditFilterState['range']; label: string }[] = [
  { value: 'all', label: 'All time' }, { value: '24h', label: '24 h' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: 'custom', label: 'Custom' },
]
const OUTCOMES: { value: '' | Outcome; label: string }[] = [
  { value: '', label: 'All' }, { value: 'success', label: 'Done' }, { value: 'denied', label: 'Blocked' }, { value: 'failure', label: 'Failed' },
]
const LIVE_MS = 30_000

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl border border-border bg-surface p-0.5">
      {options.map(o => (
        <button
          key={o.value || 'all'}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-[10px] px-2.5 py-1 text-xs font-medium transition-colors', value === o.value ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:bg-surface-2')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: 'danger' | 'warning' }) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <p className="text-[11px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className={cn('mt-1 font-display text-2xl font-semibold tabular-nums', tone === 'danger' && Number(value) > 0 ? 'text-danger' : tone === 'warning' && Number(value) > 0 ? 'text-warning' : 'text-text-primary')}>{value}</p>
    </div>
  )
}

function Integrity({ result, busy, onVerify }: { result: ChainVerification | null; busy: boolean; onVerify: () => void }) {
  const broken = result && !result.ok
  const Icon = broken ? ShieldX : result ? ShieldCheck : ShieldAlert
  return (
    <div className={cn('flex items-center gap-3 rounded-2xl border px-4 py-3', broken ? 'border-danger/40 bg-danger-light' : 'border-border bg-surface')}>
      <Icon size={20} className={broken ? 'text-danger' : result ? 'text-success' : 'text-text-muted'} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">
          {broken ? 'Integrity check failed' : result ? 'Log is intact' : 'Tamper protection on'}
        </p>
        <p className="text-xs text-text-muted">
          {broken
            ? `Entry #${result.broken_at?.chain_seq}: ${result.broken_at?.problem}`
            : result
              ? `${result.checked.toLocaleString('en-IN')} entries verified${result.unchained > 0 ? `, ${result.unchained.toLocaleString('en-IN')} older ones predate the check` : ''}`
              : 'Every entry is chained to the one before it. Verified nightly.'}
        </p>
      </div>
      <button type="button" onClick={onVerify} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-50 transition-colors">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Verify now
      </button>
    </div>
  )
}

export default function AuditLogPage() {
  const [filters, setFilters] = useState<AuditFilterState>(EMPTY_FILTERS)
  const [qInput, setQInput] = useState('')
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [facets, setFacets] = useState<AuditFacets | null>(null)
  const [selected, setSelected] = useState<AuditLogEntry | null>(null)
  const [live, setLive] = useState(false)
  const [verify, setVerify] = useState<ChainVerification | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const requestSeq = useRef(0)

  const params = useMemo(() => filtersToParams(filters), [filters])
  const paramsKey = JSON.stringify(params)

  // Search box: wait for a pause in typing before querying.
  useEffect(() => {
    const t = setTimeout(() => setFilters(f => (f.q === qInput ? f : { ...f, q: qInput })), 350)
    return () => clearTimeout(t)
  }, [qInput])

  useEffect(() => { auditLogApi.facets().then(setFacets).catch(() => undefined) }, [])

  const loadFirst = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await auditLogApi.list(JSON.parse(paramsKey) as Record<string, string>)
      if (seq !== requestSeq.current) return
      setEntries(res.entries)
      setCursor(res.next_cursor)
    } catch {
      if (seq === requestSeq.current) setError('Could not load the audit log. Try again.')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [paramsKey])

  useEffect(() => { void loadFirst() }, [loadFirst])

  const loadMore = async () => {
    if (!cursor || loadingMore) return
    setLoadingMore(true)
    try {
      const res = await auditLogApi.list(params, cursor)
      setEntries(prev => [...prev, ...res.entries.filter(e => !prev.some(p => p.id === e.id))])
      setCursor(res.next_cursor)
    } catch {
      setError('Could not load more entries.')
    } finally {
      setLoadingMore(false)
    }
  }

  // Live mode: every 30 s fetch the newest page and put anything new on top, leaving older loaded pages alone.
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => {
      auditLogApi.list(params).then(res => {
        setEntries(prev => {
          const seen = new Set(prev.map(e => e.id))
          const fresh = res.entries.filter(e => !seen.has(e.id))
          return fresh.length > 0 ? [...fresh, ...prev] : prev
        })
      }).catch(() => undefined)
    }, LIVE_MS)
    return () => clearInterval(t)
  }, [live, params])

  const patch = (p: Partial<AuditFilterState>) => setFilters(f => ({ ...f, ...p }))
  const clearAll = () => { setQInput(''); setFilters(EMPTY_FILTERS) }
  const drillDown = (p: { q?: string; targetTable?: string; targetId?: string; adminId?: string }) => {
    setSelected(null)
    if (p.q !== undefined) setQInput(p.q)
    setFilters(f => ({ ...f, ...(p.q !== undefined ? { q: p.q } : {}), ...(p.targetTable ? { targetTable: p.targetTable } : {}), ...(p.targetId ? { targetId: p.targetId } : {}), ...(p.adminId ? { adminId: p.adminId } : {}) }))
  }

  const runVerify = async () => {
    setVerifying(true)
    try { setVerify(await auditLogApi.verify()) } catch { setNotice('Could not run the integrity check.') } finally { setVerifying(false) }
  }

  const runExport = async () => {
    setExporting(true)
    setNotice(null)
    try {
      const { blob, truncated } = await auditLogApi.exportCsv(params)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ocar-audit-log-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setNotice(truncated ? 'Exported the newest 20,000 matching entries. Narrow the filters to get the rest.' : 'Export downloaded. This export has been recorded in the log.')
    } catch {
      setNotice('Export failed. Try again.')
    } finally {
      setExporting(false)
    }
  }

  const actionOptions = (facets?.actions ?? []).map(a => ({ value: a.action, label: `${humanizeAction(a.action)} · ${actionGroup(a.action)}`, count: a.count }))
  const sensitive = (facets?.actions ?? []).map(a => a.action).filter(isRiskyAction)
  const onlySensitive = sensitive.length > 0 && filters.actions.length === sensitive.length && sensitive.every(a => filters.actions.includes(a))
  const filterCount = activeFilterCount(filters)

  const columns = [
    {
      key: 'when', header: 'When', width: '130px',
      render: (e: AuditLogEntry) => (
        <div title={new Date(e.occurred_at).toLocaleString('en-IN')}>
          <p className="text-sm text-text-primary">{relativeTime(e.occurred_at)}</p>
          <p className="text-[11px] text-text-muted">{new Date(e.occurred_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
      ),
    },
    { key: 'actor', header: 'Who', width: '240px', render: (e: AuditLogEntry) => <Actor entry={e} /> },
    {
      key: 'event', header: 'What happened',
      render: (e: AuditLogEntry) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-text-primary">{humanizeAction(e.action)}</span>
            {e.outcome !== 'success' && <OutcomePill outcome={e.outcome} />}
            {isRiskyAction(e.action) && e.outcome === 'success' && <AlertTriangle size={13} className="shrink-0 text-warning" aria-label="Sensitive action" />}
          </div>
          {e.reason
            ? <p className="mt-0.5 truncate text-xs text-text-muted">“{e.reason}”</p>
            : e.changed_fields && e.changed_fields.length > 0 && <p className="mt-0.5 truncate text-xs text-text-muted">Changed {e.changed_fields.join(', ')}</p>}
        </div>
      ),
    },
    {
      key: 'target', header: 'Target', width: '150px',
      render: (e: AuditLogEntry) => <span className="text-xs text-text-muted">{e.target_id ? `${e.target_table} #${e.target_id}` : e.target_table}</span>,
    },
    { key: 'ip', header: 'IP', width: '120px', render: (e: AuditLogEntry) => <span className="text-xs font-mono text-text-muted">{e.ip_address ?? '—'}</span> },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,2fr)]">
        <Stat label="Actions · 24 h" value={facets?.stats.total_24h ?? '—'} />
        <Stat label="Active admins · 24 h" value={facets?.stats.admins_24h ?? '—'} />
        <Stat label="Blocked · 24 h" value={facets?.stats.denied_24h ?? '—'} tone="warning" />
        <Stat label="Failed · 24 h" value={facets?.stats.failed_24h ?? '—'} tone="danger" />
        <div className="col-span-2 lg:col-span-1"><Integrity result={verify} busy={verifying} onVerify={runVerify} /></div>
      </div>

      <div className="admin-card">
        <div className="space-y-3 border-b border-border-light p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
              <input
                type="search"
                value={qInput}
                onChange={e => setQInput(e.target.value)}
                placeholder="Search action, admin, reason, IP, request ID or a record number"
                aria-label="Search the audit log"
                className="w-full rounded-xl border border-border bg-surface py-2 pl-8 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none"
              />
            </div>
            <MultiSelectFilter label="Action" options={actionOptions} selected={filters.actions} onChange={actions => patch({ actions })} searchable searchPlaceholder="Find an action…" />
            <select
              aria-label="Filter by admin"
              value={filters.adminId}
              onChange={e => patch({ adminId: e.target.value })}
              className="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none"
            >
              <option value="">All admins</option>
              {(facets?.admins ?? []).map(a => <option key={a.id} value={a.id}>{a.email ?? `Admin #${a.id}`}</option>)}
            </select>
            <button
              type="button"
              onClick={() => patch({ actions: onlySensitive ? [] : sensitive })}
              disabled={sensitive.length === 0}
              aria-pressed={onlySensitive}
              className={cn('inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40', onlySensitive ? 'border-warning bg-warning-light text-warning' : 'border-border text-text-secondary hover:bg-surface-2')}
            >
              <AlertTriangle size={12} /> Sensitive only
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Segmented label="Outcome" value={filters.outcome} options={OUTCOMES} onChange={outcome => patch({ outcome })} />
            <Segmented label="Time range" value={filters.range} options={RANGES} onChange={range => patch({ range })} />
            {filters.range === 'custom' && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <input type="date" aria-label="From date" value={filters.from} max={filters.to || undefined} onChange={e => patch({ from: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary" />
                to
                <input type="date" aria-label="To date" value={filters.to} min={filters.from || undefined} onChange={e => patch({ to: e.target.value })} className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary" />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {filterCount > 0 && (
                <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><X size={12} /> Clear {filterCount} filter{filterCount > 1 ? 's' : ''}</button>
              )}
              <button type="button" onClick={() => setLive(l => !l)} aria-pressed={live} className={cn('inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors', live ? 'border-success bg-success-light text-success' : 'border-border text-text-secondary hover:bg-surface-2')}>
                <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-success motion-safe:animate-pulse' : 'bg-text-muted')} /> Live
              </button>
              <button type="button" onClick={() => void loadFirst()} aria-label="Refresh" className="rounded-xl border border-border p-2 text-text-secondary hover:bg-surface-2 transition-colors"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
              <button type="button" onClick={() => void runExport()} disabled={exporting} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-surface-2 disabled:opacity-50 transition-colors">
                {exporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Export CSV
              </button>
            </div>
          </div>

          {(filters.targetTable || filters.targetId) && (
            <p className="flex items-center gap-2 text-xs text-text-muted">
              Showing only <span className="font-mono text-text-primary">{filters.targetTable} {filters.targetId && `#${filters.targetId}`}</span>
              <button type="button" onClick={() => patch({ targetTable: '', targetId: '' })} className="text-primary hover:underline">show all</button>
            </p>
          )}
          {notice && <p role="status" className="text-xs text-text-secondary">{notice}</p>}
        </div>

        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 border-b border-border-light bg-danger-light px-4 py-3 text-sm text-danger">
            {error}
            <button type="button" onClick={() => void loadFirst()} className="font-medium underline">Retry</button>
          </div>
        )}

        <DataTable
          isLoading={loading}
          emptyMessage={filterCount > 0 ? 'No entries match these filters' : 'No admin actions logged yet'}
          emptyIcon={<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2"><ScrollText size={20} className="text-text-muted" /></div>}
          data={entries as unknown as Record<string, unknown>[]}
          columns={columns as unknown as { key: string; header: string; width?: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
          onRowClick={row => setSelected(row as unknown as AuditLogEntry)}
        />

        {!loading && entries.length > 0 && (
          <div className="flex items-center justify-between border-t border-border-light px-5 py-4">
            <p className="text-xs text-text-muted">{entries.length.toLocaleString('en-IN')} entr{entries.length === 1 ? 'y' : 'ies'} loaded{cursor ? '' : ' · end of log'}</p>
            {cursor && (
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-50 transition-colors">
                {loadingMore && <Loader2 size={12} className="animate-spin" />} Load older entries
              </button>
            )}
          </div>
        )}
      </div>

      <SlideOver isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? humanizeAction(selected.action) : ''} width="lg">
        {selected && <AuditDetail entry={selected} onFilter={drillDown} />}
      </SlideOver>
    </div>
  )
}
