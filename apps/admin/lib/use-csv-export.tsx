'use client'
import { useCallback, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { useAdminAuth } from './auth-context'
import { downloadCsv } from './csv-download'

const plural = (n: string) => (/(s|x|ch|sh)$/.test(n) ? `${n}es` : `${n}s`)

/**
 * The state every list page needs for its Export CSV button: whether this admin's role may export, a busy flag, and a one-line
 * result (rows exported, or the server's reason it was refused). `roles` mirrors the server's role gate; the server still enforces it.
 */
export function useCsvExport(path: string, roles: readonly string[]) {
  const { admin } = useAdminAuth()
  const allowed = !!admin && roles.includes(admin.role)
  const [exporting, setExporting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const run = useCallback(async (params: Record<string, string | undefined> = {}, noun = 'row', note?: string) => {
    setExporting(true)
    setResult(null)
    try {
      const { rows } = await downloadCsv(path, params)
      setResult({ ok: true, text: rows === null ? 'Export downloaded.' : `Exported ${rows.toLocaleString('en-IN')} ${rows === 1 ? noun : plural(noun)}${note ? ` (${note})` : ''}. This export was recorded in the audit log.` })
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : 'Export failed. Try again.' })
    } finally {
      setExporting(false)
    }
  }, [path])

  return { allowed, exporting, result, run }
}

export function ExportStatus({ result }: { result: { ok: boolean; text: string } | null }) {
  if (!result) return null
  return (
    <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'text-xs font-medium text-text-secondary' : 'text-xs font-medium text-danger'}>
      {result.text}
    </p>
  )
}

// Mirrors of the server's role gates for the export routes.
export const OPS_ROLES = ['super_admin', 'ops_admin'] as const
export const FINANCE_ROLES = ['super_admin', 'finance_admin'] as const

/** The same button FilterBar shows, for pages that have no FilterBar (tabs, card headers). Render it only when `exp.allowed`. */
export function ExportButton({ exporting, onClick }: { exporting: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={exporting}
      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-text-secondary border border-border rounded-xl hover:bg-surface-2 disabled:opacity-50 transition-colors">
      {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
      Export CSV
    </button>
  )
}
