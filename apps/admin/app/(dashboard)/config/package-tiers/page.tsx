'use client'
import { useState, useEffect, useCallback } from 'react'
import { Package as PackageIcon } from 'lucide-react'
import { packageApi, type PackageTier } from '@/lib/package-api'

const inputCls = 'w-full border border-border rounded-xl px-3 py-2 text-sm text-text-primary bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted'

function fmt(v: string): string {
  return `₹${parseFloat(v).toFixed(2)}`
}

export default function PackageTiersPage() {
  const [tiers, setTiers] = useState<PackageTier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ label: '', price: '', thresholdValue: '', vehicleGroup: 'cab' as 'cab' | 'auto', validityDays: '365' })
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setTiers(await packageApi.listTiers())
    } catch {
      setError('Failed to load package tiers.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await packageApi.createTier({
        label: form.label,
        price: Number(form.price),
        thresholdValue: Number(form.thresholdValue),
        vehicleGroup: form.vehicleGroup,
        validityDays: Number(form.validityDays),
      })
      setForm({ label: '', price: '', thresholdValue: '', vehicleGroup: form.vehicleGroup, validityDays: form.validityDays })
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleToggle(tier: PackageTier) {
    await packageApi.updateTier(tier.id, { isActive: !tier.is_active })
    void load()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center">
          <PackageIcon size={20} className="text-primary" />
        </div>
        <div>
          <h1 className="page-title">Package Tiers</h1>
          <p className="page-subtitle">Prepaid ride value for package-billing cities. GST is added on top of the price when the driver buys; the driver gets the full ride value.</p>
        </div>
      </div>

      <div className="admin-card !p-0 overflow-hidden">
        <table className="data-table">
          <thead>
            <tr>
              <th>Label</th>
              <th>Drivers</th>
              <th>Price</th>
              <th>GST</th>
              <th>Driver pays</th>
              <th>Ride value</th>
              <th>Valid for</th>
              <th className="!text-center">Active</th>
              <th className="!text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="!text-center py-12 text-text-muted">Loading…</td></tr>
            ) : error ? (
              <tr><td colSpan={9} className="!text-center py-12 text-danger">{error}</td></tr>
            ) : tiers.length === 0 ? (
              <tr><td colSpan={9} className="!text-center py-12 text-text-muted">No package tiers yet. Add the first one.</td></tr>
            ) : tiers.map(t => (
              <tr key={t.id}>
                <td className="font-semibold text-text-primary">{t.label}</td>
                <td>{t.vehicle_group === 'auto' ? 'Autos' : 'Cabs'}</td>
                <td>{fmt(t.price)}</td>
                <td className="text-text-muted">{fmt(t.gst_amount)} <span className="text-xs">({t.gst_percent}%)</span></td>
                <td className="font-semibold">{fmt(t.total_amount)}</td>
                <td>{fmt(t.threshold_value)}</td>
                <td>{t.validity_days} days</td>
                <td className="!text-center">{t.is_active ? <span className="pill-success">Active</span> : <span className="pill-muted">Inactive</span>}</td>
                <td className="!text-right">
                  <button onClick={() => handleToggle(t)} className="text-xs font-semibold text-primary hover:underline">
                    {t.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-card">
        <h2 className="text-sm font-bold text-text-primary mb-4">Add Package Tier</h2>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-semibold text-text-muted mb-1.5">Label</label>
            <input required value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
              className={inputCls} placeholder="e.g. Starter" />
          </div>
          <div className="w-32">
            <label className="block text-xs font-semibold text-text-muted mb-1.5">Price (₹)</label>
            <input required type="number" min="0" step="any" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
              className={inputCls} />
          </div>
          <div className="w-36">
            <label className="block text-xs font-semibold text-text-muted mb-1.5">Ride value (₹)</label>
            <input required type="number" min="0" step="any" value={form.thresholdValue} onChange={e => setForm(f => ({ ...f, thresholdValue: e.target.value }))}
              className={inputCls} />
          </div>
          <div className="w-32">
            <label className="block text-xs font-semibold text-text-muted mb-1.5">For drivers of</label>
            <select value={form.vehicleGroup} onChange={e => setForm(f => ({ ...f, vehicleGroup: e.target.value as 'cab' | 'auto' }))} className={inputCls}>
              <option value="cab">Cabs</option>
              <option value="auto">Autos</option>
            </select>
          </div>
          <div className="w-28">
            <label className="block text-xs font-semibold text-text-muted mb-1.5">Valid (days)</label>
            <input required type="number" min="1" max="3650" step="1" value={form.validityDays} onChange={e => setForm(f => ({ ...f, validityDays: e.target.value }))}
              className={inputCls} />
          </div>
          <button type="submit" disabled={submitting} className="btn-primary disabled:opacity-50 disabled:pointer-events-none">
            {submitting ? 'Adding…' : 'Add Tier'}
          </button>
        </form>
      </div>
    </div>
  )
}
