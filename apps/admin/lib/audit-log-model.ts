// Pure helpers for the Audit Log page: naming, grouping, diffing and filter handling. No React, no network.

export type Outcome = 'success' | 'failure' | 'denied'

export interface AuditFilterState {
  q: string
  adminId: string
  actions: string[]          // exact names, or "prefix.*"
  outcome: '' | Outcome
  source: '' | 'service' | 'http' | 'auth' | 'system'
  range: 'all' | '24h' | '7d' | '30d' | 'custom'
  from: string               // yyyy-mm-dd, used when range === 'custom'
  to: string
  targetTable: string
  targetId: string
}

export const EMPTY_FILTERS: AuditFilterState = {
  q: '', adminId: '', actions: [], outcome: '', source: '', range: 'all', from: '', to: '', targetTable: '', targetId: '',
}

export function activeFilterCount(f: AuditFilterState): number {
  return [f.q, f.adminId, f.outcome, f.source, f.targetTable, f.targetId].filter(Boolean).length
    + (f.actions.length > 0 ? 1 : 0) + (f.range !== 'all' ? 1 : 0)
}

/** Query-string params for the API. `now` is injectable for tests. */
export function filtersToParams(f: AuditFilterState, now: Date = new Date()): Record<string, string> {
  const p: Record<string, string> = {}
  if (f.q.trim()) p['q'] = f.q.trim()
  if (f.adminId) p['admin_id'] = f.adminId
  if (f.actions.length > 0) p['action'] = f.actions.join(',')
  if (f.outcome) p['outcome'] = f.outcome
  if (f.source) p['source'] = f.source
  if (f.targetTable) p['target_table'] = f.targetTable
  if (f.targetId) p['target_id'] = f.targetId
  const hours = f.range === '24h' ? 24 : f.range === '7d' ? 24 * 7 : f.range === '30d' ? 24 * 30 : 0
  if (hours > 0) p['from'] = new Date(now.getTime() - hours * 3600_000).toISOString()
  if (f.range === 'custom') {
    // Local-day boundaries, so "to 12 Nov" includes everything on 12 Nov in the admin's own timezone.
    if (f.from) p['from'] = new Date(`${f.from}T00:00:00`).toISOString()
    if (f.to) { const d = new Date(`${f.to}T00:00:00`); d.setDate(d.getDate() + 1); p['to'] = d.toISOString() }
  }
  return p
}

// ── Naming ────────────────────────────────────────────────────────────────────

export function humanizeAction(action: string): string {
  const s = action.replace(/[._-]+/g, ' ').trim()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const GROUPS: [RegExp, string][] = [
  [/^auth\./, 'Sign-in'],
  [/^(admins|admin_totp|admin-invites|invites)/, 'Admin access'],
  [/^(drivers|verifications)/, 'Drivers'],
  [/^(vehicles|vehicle_documents)/, 'Vehicles'],
  [/^(pricing|package|packages)/, 'Pricing'],
  [/^(geo|cities)/, 'Cities'],
  [/^(safety|sos|disputes)/, 'Safety'],
  [/^(rides|dispatch)/, 'Rides'],
  [/^(payments|payouts|settlements|analytics)/, 'Payments & reports'],
  [/^(system_config|maintenance|notification|templates)/, 'System'],
]

export function actionGroup(action: string): string {
  return GROUPS.find(([re]) => re.test(action))?.[1] ?? 'Other'
}

export function outcomeLabel(o: Outcome): string {
  return o === 'success' ? 'Done' : o === 'denied' ? 'Blocked' : 'Failed'
}

export function outcomeTone(o: Outcome): 'success' | 'danger' | 'warning' {
  return o === 'success' ? 'success' : o === 'denied' ? 'warning' : 'danger'
}

const RISKY = /^(drivers\.delete|admins\.|admin_totp\.disabled|system_config\.|maintenance_mode\.|audit_log\.export|analytics_export$)|balance|force-resolve|rate-cards\.create|reset-2fa|sign-out|\.role\./
export function isRiskyAction(action: string): boolean { return RISKY.test(action) }

// ── Diff ──────────────────────────────────────────────────────────────────────

export interface DiffRow { field: string; before: unknown; after: unknown; kind: 'added' | 'removed' | 'changed' }

function flatten(v: unknown, prefix: string, out: Record<string, unknown>, depth = 0): void {
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && depth < 3) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) flatten(val, prefix ? `${prefix}.${k}` : k, out, depth + 1)
    if (Object.keys(v as object).length === 0 && prefix) out[prefix] = {}
  } else {
    out[prefix] = v
  }
}

/** Field-by-field differences, nested objects flattened to dotted paths. Unchanged fields are omitted. */
export function diffRows(before: Record<string, unknown> | null, after: Record<string, unknown> | null): DiffRow[] {
  const b: Record<string, unknown> = {}
  const a: Record<string, unknown> = {}
  if (before) flatten(before, '', b)
  if (after) flatten(after, '', a)
  const rows: DiffRow[] = []
  for (const field of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    const inB = field in b
    const inA = field in a
    if (inB && inA && JSON.stringify(b[field]) === JSON.stringify(a[field])) continue
    rows.push({ field, before: b[field] ?? null, after: a[field] ?? null, kind: !inB ? 'added' : !inA ? 'removed' : 'changed' })
  }
  return rows
}

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v === '' ? '(empty)' : v
  return JSON.stringify(v)
}

// ── Time and client ───────────────────────────────────────────────────────────

export function relativeTime(iso: string, now: Date = new Date()): string {
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function describeClient(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /axios|node|curl|okhttp/i.test(ua) ? 'Script / API client' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return os ? `${browser} on ${os}` : browser
}

export function initials(email: string | null): string {
  if (!email) return 'SY'
  const name = email.split('@')[0] ?? ''
  const parts = name.split(/[._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? parts[0]?.[1] ?? '')).toUpperCase()
}

/** Where the target can be opened in the admin app, if anywhere. */
export function targetHref(table: string, id: string | null): string | null {
  if (!id) return null
  if (table === 'drivers') return `/drivers/${id}`
  return null
}
