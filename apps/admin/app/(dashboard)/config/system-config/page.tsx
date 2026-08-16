'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import { Pencil, Check, X } from 'lucide-react'
import SlideOver from '@/components/ui/SlideOver'
import { systemConfigApi, type SystemConfig } from '@/lib/system-config-api'

export default function SystemConfigPage() {
  const [config, setConfig] = useState<SystemConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<SystemConfig | null>(null)
  const [valueDraft, setValueDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      setConfig(await systemConfigApi.list())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const openEdit = (c: SystemConfig) => {
    setEditing(c)
    setValueDraft(c.value)
    setError(null)
  }

  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const updated = await systemConfigApi.update(editing.id, valueDraft)
      setConfig(prev => prev.map(c => c.id === updated.id ? updated : c))
      setEditing(null)
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Update failed' : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="admin-card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '240px' }}>Key</th>
              <th style={{ width: '90px' }}>Type</th>
              <th>Value</th>
              <th style={{ width: '80px' }}>Edit</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-text-muted text-xs py-6 text-center">Loading config…</td></tr>
            ) : config.length === 0 ? (
              <tr><td colSpan={4} className="text-text-muted text-xs py-6 text-center">No config found.</td></tr>
            ) : config.map(c => (
              <tr key={c.id}>
                <td>
                  <code className="text-xs font-mono text-text-primary">{c.key}</code>
                  {c.description && <p className="text-[11px] text-text-muted mt-0.5">{c.description}</p>}
                </td>
                <td>
                  <span className="pill pill-info text-[10px]">{c.valueType}</span>
                </td>
                <td className="text-xs font-mono text-text-muted truncate max-w-[300px]">{c.value}</td>
                <td>
                  <button
                    onClick={() => openEdit(c)}
                    className="text-text-muted hover:text-primary transition-colors p-1 rounded hover:bg-primary-light"
                  >
                    <Pencil size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlideOver isOpen={!!editing} onClose={() => setEditing(null)} title={editing?.key ?? ''}>
        {editing && (
          <div className="p-6 space-y-5">
            {editing.description && (
              <p className="text-xs text-text-muted">{editing.description}</p>
            )}

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Value</label>
              {editing.valueType === 'boolean' ? (
                <select
                  value={valueDraft}
                  onChange={e => setValueDraft(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : (
                <input
                  value={valueDraft}
                  onChange={e => setValueDraft(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors font-mono"
                />
              )}
              {error && <p className="text-xs text-error mt-1.5">{error}</p>}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors"
              >
                <X size={14} className="inline mr-1.5 -mt-0.5" />
                Cancel
              </button>
              <button
                onClick={() => void saveEdit()}
                disabled={saving || valueDraft.trim().length === 0}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Check size={14} className="inline mr-1.5 -mt-0.5" />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  )
}
