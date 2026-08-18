'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import { maintenanceApi, type MaintenanceStatus } from '@/lib/maintenance-api'

export default function MaintenancePage() {
  const [status, setStatus] = useState<MaintenanceStatus>({ enabled: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setStatus(await maintenanceApi.get())
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const save = async (next: MaintenanceStatus) => {
    setSaving(true)
    setError(null)
    try {
      setStatus(await maintenanceApi.update(next))
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.error ?? 'Update failed' : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="admin-card p-6 text-text-muted text-xs">Loading…</div>
  }

  return (
    <div className="space-y-5">
      <div className="admin-card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-text-primary">Maintenance Mode</p>
            <p className="text-xs text-text-muted mt-0.5">
              Blocks every API request (all three apps) with a 503 until turned off. Health
              checks keep passing — instances stay in rotation, they just refuse app traffic.
            </p>
          </div>
          <button
            onClick={() => void save({ ...status, enabled: !status.enabled })}
            disabled={saving}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 ${
              status.enabled
                ? 'bg-danger text-white hover:opacity-90'
                : 'bg-primary text-white hover:opacity-90'
            }`}
          >
            {status.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">
            Message shown to users (optional)
          </label>
          <textarea
            value={status.message ?? ''}
            onChange={e => setStatus(s => ({ ...s, message: e.target.value }))}
            rows={2}
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
            placeholder="Ocar is briefly offline for maintenance."
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary mb-1.5">
            Retry-After (seconds, optional)
          </label>
          <input
            type="number"
            min={1}
            value={status.retryAfterSeconds ?? ''}
            onChange={e => setStatus(s => ({
              ...s,
              retryAfterSeconds: e.target.value === '' ? undefined : Number(e.target.value),
            }))}
            className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors font-mono"
            placeholder="60"
          />
        </div>

        {error && <p className="text-xs text-error">{error}</p>}

        <button
          onClick={() => void save(status)}
          disabled={saving}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save message / retry settings'}
        </button>
      </div>
    </div>
  )
}
