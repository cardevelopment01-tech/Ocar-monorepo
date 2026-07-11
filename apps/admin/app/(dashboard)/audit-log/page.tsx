'use client'

import { useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import SlideOver from '@/components/ui/SlideOver'
import { auditLogApi, type AuditLogEntry } from '@/lib/audit-log-api'

const LIMIT = 50

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function ActorCell({ entry }: { entry: AuditLogEntry }) {
  if (!entry.admin_id) {
    return <span className="text-sm text-text-muted italic">System</span>
  }
  return (
    <div>
      <p className="text-sm font-medium text-text-primary">{entry.admin_email ?? `Admin #${entry.admin_id}`}</p>
      {entry.admin_role && <p className="text-xs text-text-muted capitalize">{entry.admin_role.replace('_', ' ')}</p>}
    </div>
  )
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [selected, setSelected] = useState<AuditLogEntry | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const res = await auditLogApi.list({ page, limit: LIMIT })
        setEntries(res.entries)
        setTotal(res.pagination.total)
        setPages(res.pagination.pages)
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [page])

  const columns = [
    { key: 'created_at', header: 'Time', width: '160px', render: (e: AuditLogEntry) => <span className="text-xs text-text-muted">{formatDateTime(e.created_at)}</span> },
    { key: 'admin', header: 'Admin', width: '220px', render: (e: AuditLogEntry) => <ActorCell entry={e} /> },
    { key: 'action', header: 'Action', render: (e: AuditLogEntry) => <code className="text-xs font-mono text-text-primary">{e.action}</code> },
    { key: 'target', header: 'Target', width: '180px', render: (e: AuditLogEntry) => <span className="text-xs text-text-muted">{e.target_table} #{e.target_id}</span> },
    { key: 'ip_address', header: 'IP', width: '130px', render: (e: AuditLogEntry) => <span className="text-xs font-mono text-text-muted">{e.ip_address ?? '—'}</span> },
  ]

  return (
    <div className="space-y-5">
      <div className="admin-card">
        <DataTable
          isLoading={loading}
          emptyMessage="No admin actions logged yet"
          emptyIcon={
            <div className="w-12 h-12 rounded-2xl bg-surface-2 flex items-center justify-center mb-3">
              <ScrollText size={20} className="text-text-muted" />
            </div>
          }
          data={entries as unknown as Record<string, unknown>[]}
          columns={columns as unknown as { key: string; header: string; width?: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
          onRowClick={row => setSelected(row as unknown as AuditLogEntry)}
        />

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-border-light">
            <p className="text-xs text-text-muted">Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Previous</button>
              <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      <SlideOver isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.target_table} #${selected.target_id}` : ''}>
        {selected && (
          <div className="p-6 space-y-5">
            <div className="flex flex-wrap gap-2">
              <span className="pill pill-info text-[10px] font-mono">{selected.action}</span>
              <span className="pill pill-muted text-[10px]">{formatDateTime(selected.created_at)}</span>
              {selected.ip_address && <span className="pill pill-muted text-[10px] font-mono">{selected.ip_address}</span>}
            </div>

            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Actor</p>
              <ActorCell entry={selected} />
            </div>

            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Before</p>
              <pre className="text-[11px] font-mono bg-surface-2 text-text-muted rounded-xl p-3 overflow-x-auto max-h-64 overflow-y-auto">
                {selected.before_state ? JSON.stringify(selected.before_state, null, 2) : 'null'}
              </pre>
            </div>

            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">After</p>
              <pre className="text-[11px] font-mono bg-surface-2 text-text-muted rounded-xl p-3 overflow-x-auto max-h-64 overflow-y-auto">
                {selected.after_state ? JSON.stringify(selected.after_state, null, 2) : 'null'}
              </pre>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  )
}
