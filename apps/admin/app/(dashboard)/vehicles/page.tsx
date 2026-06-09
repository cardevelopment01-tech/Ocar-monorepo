'use client'
import React, { useState, useEffect, useCallback } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Car, Tag, Layers, FileText, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import StatCard from '@/components/ui/StatCard'
import { cn } from '@/lib/utils'
import {
  vehicleCategoryApi, vehicleBrandApi, vehicleModelApi, fleetApi, vehicleDocApi,
  type VehicleCategory, type VehicleBrand, type VehicleModel,
  type FleetVehicle, type PendingVehicleDoc, type ExpiringVehicleDoc,
} from '@/lib/vehicle-api'

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}
function docLabel(k: string) { return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }
function daysLeft(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000)
}

// ─── primitives ───────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex w-9 h-5 rounded-full transition-colors duration-200 flex-shrink-0',
        checked ? 'bg-success' : 'bg-border'
      )}
    >
      <span className={cn(
        'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200',
        checked ? 'translate-x-4' : 'translate-x-0'
      )} />
    </button>
  )
}

function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return <>{Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="border-b border-border-light">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-4 py-3">
          <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: j === 0 ? 140 : 80 }} />
        </td>
      ))}
    </tr>
  ))}</>
}

function EmptyState({ message }: { message: string }) {
  return (
    <tr><td colSpan={99} className="!border-0">
      <div className="py-14 text-center text-text-muted text-sm">{message}</div>
    </td></tr>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <tr><td colSpan={99} className="!border-0">
      <div className="py-14 text-center">
        <p className="text-text-muted text-sm mb-2">Failed to load data.</p>
        <button onClick={onRetry} className="text-xs text-primary underline">Retry</button>
      </div>
    </td></tr>
  )
}

// ─── shared reason / confirm dialogs ─────────────────────────────────────────

interface ReasonDialogProps {
  open: boolean; title: string; description: string
  confirmLabel: string; variant: 'danger' | 'warning'
  loading: boolean; onCancel: () => void; onConfirm: (r: string) => void
}
function ReasonDialog({ open, title, description, confirmLabel, variant, loading, onCancel, onConfirm }: ReasonDialogProps) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (!open) setReason('') }, [open])
  const btnCls = variant === 'danger' ? 'bg-danger text-white hover:bg-red-600' : 'bg-warning text-white hover:bg-amber-600'
  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[440px]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-2">{title}</Dialog.Title>
          <Dialog.Description className="text-sm text-text-secondary mb-4">{description}</Dialog.Description>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Enter reason (min 10 chars)…"
            className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 placeholder:text-text-muted mb-1" />
          <p className="text-xs text-text-muted mb-5">{reason.trim().length}/10 min</p>
          <div className="flex gap-3 justify-end">
            <button onClick={onCancel} className="px-4 py-2 text-sm border border-border rounded-xl hover:bg-surface-2">Cancel</button>
            <button onClick={() => onConfirm(reason.trim())} disabled={reason.trim().length < 10 || loading}
              className={cn('px-4 py-2 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed', btnCls)}>
              {loading ? 'Submitting…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── field dialog (add/edit generic) ─────────────────────────────────────────

interface FieldDef { key: string; label: string; type: 'text' | 'number' | 'toggle'; readOnly?: boolean; min?: number; max?: number }

interface FieldDialogProps {
  open: boolean; title: string; fields: FieldDef[]
  values: Record<string, unknown>; onChange: (k: string, v: unknown) => void
  loading: boolean; onCancel: () => void; onConfirm: () => void; confirmLabel?: string
}
function FieldDialog({ open, title, fields, values, onChange, loading, onCancel, onConfirm, confirmLabel = 'Save' }: FieldDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={v => { if (!v) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[420px]">
          <Dialog.Title className="text-lg font-bold text-text-primary mb-5">{title}</Dialog.Title>
          <div className="space-y-4">
            {fields.map(f => (
              <div key={f.key}>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">{f.label}</label>
                {f.type === 'toggle' ? (
                  <Toggle checked={!!values[f.key]} onChange={v => onChange(f.key, v)} />
                ) : (
                  <input
                    type={f.type} value={String(values[f.key] ?? '')}
                    onChange={e => onChange(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
                    readOnly={f.readOnly} min={f.min} max={f.max}
                    className={cn(
                      'w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30',
                      f.readOnly && 'opacity-50 cursor-not-allowed'
                    )}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-3 justify-end mt-6">
            <button onClick={onCancel} className="px-4 py-2 text-sm border border-border rounded-xl hover:bg-surface-2">Cancel</button>
            <button onClick={onConfirm} disabled={loading}
              className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed">
              {loading ? 'Saving…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'categories' | 'brands' | 'fleet' | 'documents'
const TABS: { key: Tab; label: string }[] = [
  { key: 'categories', label: 'Categories' },
  { key: 'brands',     label: 'Brands & Models' },
  { key: 'fleet',      label: 'Fleet' },
  { key: 'documents',  label: 'Documents' },
]

// ─── page ─────────────────────────────────────────────────────────────────────

export default function VehiclesPage() {
  const [tab, setTab] = useState<Tab>('categories')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Vehicle Management</h1>
        <p className="text-text-muted text-sm mt-0.5">Manage categories, brands, fleet and documents</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-border">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('px-5 py-2.5 text-sm font-semibold transition-colors whitespace-nowrap',
              tab === t.key ? 'border-b-2 border-primary text-primary' : 'text-text-muted hover:text-text-secondary'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'categories' && <CategoriesTab />}
      {tab === 'brands'     && <BrandsTab />}
      {tab === 'fleet'      && <FleetTab />}
      {tab === 'documents'  && <DocumentsTab />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CATEGORIES TAB
// ══════════════════════════════════════════════════════════════════════════════

function CategoriesTab() {
  const [data, setData] = useState<VehicleCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<VehicleCategory | null>(null)
  const [formVals, setFormVals] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try { setData(await vehicleCategoryApi.list()) }
    catch { setError(true) }
    finally { setLoading(false) }
  }, [retry]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  function openAdd() {
    setFormVals({ slug: '', display_name: '', max_passengers: 4, is_active: true })
    setAddOpen(true)
  }
  function openEdit(cat: VehicleCategory) {
    setFormVals({ slug: cat.slug, display_name: cat.display_name, max_passengers: cat.max_passengers, is_active: cat.is_active })
    setEditTarget(cat)
  }

  async function handleAdd() {
    setSaving(true)
    try {
      const created = await vehicleCategoryApi.create({
        slug: String(formVals.slug), display_name: String(formVals.display_name),
        max_passengers: Number(formVals.max_passengers), is_active: !!formVals.is_active,
      })
      setData(prev => [...prev, created])
      setAddOpen(false)
    } catch { /* let user retry */ } finally { setSaving(false) }
  }

  async function handleEdit() {
    if (!editTarget) return
    setSaving(true)
    try {
      const updated = await vehicleCategoryApi.update(editTarget.id, {
        display_name: String(formVals.display_name),
        max_passengers: Number(formVals.max_passengers),
        is_active: !!formVals.is_active,
      })
      setData(prev => prev.map(c => c.id === updated.id ? { ...updated, driver_count: c.driver_count } : c))
      setEditTarget(null)
    } catch { } finally { setSaving(false) }
  }

  async function toggleActive(cat: VehicleCategory) {
    try {
      await vehicleCategoryApi.update(cat.id, { is_active: !cat.is_active })
      setData(prev => prev.map(c => c.id === cat.id ? { ...c, is_active: !c.is_active } : c))
    } catch { }
  }

  const active = data.filter(c => c.is_active).length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <StatCard title="Total Categories" value={data.length} change="All types" changeType="neutral" icon={Tag} gradient="blue" />
        <StatCard title="Active Categories" value={active} change="In use" changeType="up" icon={CheckCircle} gradient="green" />
      </div>

      <div className="admin-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-text-primary">Categories</h2>
          <button onClick={openAdd} className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary-dark transition-colors">
            + Add Category
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>
              <th>Display Name</th><th>Slug</th><th>Max Passengers</th>
              <th>Drivers Using</th><th>Status</th><th>Active</th><th></th>
            </tr></thead>
            <tbody>
              {loading ? <SkeletonRows cols={7} /> :
               error   ? <ErrorState onRetry={() => setRetry(n => n + 1)} /> :
               data.length === 0 ? <EmptyState message="No categories yet" /> :
               data.map(cat => (
                <tr key={cat.id} className="group">
                  <td className="font-semibold text-text-primary">{cat.display_name}</td>
                  <td><span className="font-mono text-xs text-text-muted">{cat.slug}</span></td>
                  <td className="text-text-secondary">{cat.max_passengers}</td>
                  <td><span className="text-sm font-semibold text-text-primary">{cat.driver_count}</span></td>
                  <td><StatusPill status={cat.is_active ? 'active' : 'inactive'} /></td>
                  <td><Toggle checked={cat.is_active} onChange={() => toggleActive(cat)} /></td>
                  <td>
                    <button onClick={() => openEdit(cat)} className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <FieldDialog open={addOpen} title="Add Category"
        fields={[
          { key: 'slug', label: 'Slug (lowercase, no spaces)', type: 'text' },
          { key: 'display_name', label: 'Display Name', type: 'text' },
          { key: 'max_passengers', label: 'Max Passengers', type: 'number', min: 1, max: 20 },
          { key: 'is_active', label: 'Active', type: 'toggle' },
        ]}
        values={formVals} onChange={(k, v) => setFormVals(p => ({ ...p, [k]: k === 'slug' ? String(v).toLowerCase().replace(/\s+/g, '-') : v }))}
        loading={saving} onCancel={() => setAddOpen(false)} onConfirm={handleAdd} confirmLabel="Add Category"
      />

      <FieldDialog open={!!editTarget} title={`Edit — ${editTarget?.display_name}`}
        fields={[
          { key: 'slug', label: 'Slug (cannot change)', type: 'text', readOnly: true },
          { key: 'display_name', label: 'Display Name', type: 'text' },
          { key: 'max_passengers', label: 'Max Passengers', type: 'number', min: 1, max: 20 },
          { key: 'is_active', label: 'Active', type: 'toggle' },
        ]}
        values={formVals} onChange={(k, v) => setFormVals(p => ({ ...p, [k]: v }))}
        loading={saving} onCancel={() => setEditTarget(null)} onConfirm={handleEdit}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// BRANDS & MODELS TAB
// ══════════════════════════════════════════════════════════════════════════════

function BrandsTab() {
  const [brands, setBrands] = useState<VehicleBrand[]>([])
  const [models, setModels] = useState<VehicleModel[]>([])
  const [categories, setCategories] = useState<VehicleCategory[]>([])
  const [selectedBrand, setSelectedBrand] = useState<VehicleBrand | null>(null)
  const [brandsLoading, setBrandsLoading] = useState(true)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [brandsError, setBrandsError] = useState(false)
  const [retry, setRetry] = useState(0)

  const [addBrandOpen, setAddBrandOpen] = useState(false)
  const [editBrand, setEditBrand] = useState<VehicleBrand | null>(null)
  const [addModelOpen, setAddModelOpen] = useState(false)
  const [editModel, setEditModel] = useState<VehicleModel | null>(null)
  const [formVals, setFormVals] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setBrandsLoading(true); setBrandsError(false)
    Promise.all([vehicleBrandApi.list(), vehicleCategoryApi.list()])
      .then(([b, c]) => { setBrands(b); setCategories(c) })
      .catch(() => setBrandsError(true))
      .finally(() => setBrandsLoading(false))
  }, [retry])

  useEffect(() => {
    if (!selectedBrand) { setModels([]); return }
    setModelsLoading(true)
    vehicleModelApi.list(selectedBrand.id)
      .then(setModels)
      .catch(() => setModels([]))
      .finally(() => setModelsLoading(false))
  }, [selectedBrand])

  async function toggleBrandActive(b: VehicleBrand) {
    try {
      await vehicleBrandApi.update(b.id, { is_active: !b.is_active })
      setBrands(prev => prev.map(x => x.id === b.id ? { ...x, is_active: !x.is_active } : x))
    } catch { }
  }

  async function handleAddBrand() {
    setSaving(true)
    try {
      const created = await vehicleBrandApi.create({ name: String(formVals.name), is_active: !!formVals.is_active })
      setBrands(prev => [...prev, created])
      setAddBrandOpen(false)
    } catch { } finally { setSaving(false) }
  }

  async function handleEditBrand() {
    if (!editBrand) return
    setSaving(true)
    try {
      await vehicleBrandApi.update(editBrand.id, { name: String(formVals.name), is_active: !!formVals.is_active })
      setBrands(prev => prev.map(b => b.id === editBrand.id ? { ...b, name: String(formVals.name), is_active: !!formVals.is_active } : b))
      setEditBrand(null)
    } catch { } finally { setSaving(false) }
  }

  async function handleAddModel() {
    if (!selectedBrand) return
    setSaving(true)
    try {
      const created = await vehicleModelApi.create({
        brand_id: selectedBrand.id,
        name: String(formVals.name),
        typical_category_id: formVals.typical_category_id ? String(formVals.typical_category_id) : null,
        is_active: !!formVals.is_active,
      })
      const catName = categories.find(c => c.id === formVals.typical_category_id)?.display_name ?? null
      setModels(prev => [...prev, { ...created, brand_name: selectedBrand.name, typical_category_name: catName }])
      setBrands(prev => prev.map(b => b.id === selectedBrand.id ? { ...b, model_count: b.model_count + 1 } : b))
      setAddModelOpen(false)
    } catch { } finally { setSaving(false) }
  }

  async function handleEditModel() {
    if (!editModel) return
    setSaving(true)
    try {
      await vehicleModelApi.update(editModel.id, {
        name: String(formVals.name),
        typical_category_id: formVals.typical_category_id ? String(formVals.typical_category_id) : null,
        is_active: !!formVals.is_active,
      })
      const catName = categories.find(c => c.id === String(formVals.typical_category_id))?.display_name ?? null
      setModels(prev => prev.map(m => m.id === editModel.id
        ? { ...m, name: String(formVals.name), is_active: !!formVals.is_active, typical_category_name: catName }
        : m))
      setEditModel(null)
    } catch { } finally { setSaving(false) }
  }

  async function toggleModelActive(m: VehicleModel) {
    try {
      await vehicleModelApi.update(m.id, { is_active: !m.is_active })
      setModels(prev => prev.map(x => x.id === m.id ? { ...x, is_active: !x.is_active } : x))
    } catch { }
  }

  const categoryOptions = categories.map(c => `${c.id}:${c.display_name}`)

  return (
    <div className="flex gap-4">
      {/* Brand list */}
      <div className="w-[40%] admin-card flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-text-primary">Brands</h2>
          <button onClick={() => { setFormVals({ name: '', is_active: true }); setAddBrandOpen(true) }}
            className="px-3 py-1 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary-dark">
            + Add Brand
          </button>
        </div>
        {brandsLoading ? (
          <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 bg-surface-2 rounded-xl animate-pulse" />
          ))}</div>
        ) : brandsError ? (
          <div className="py-8 text-center">
            <p className="text-text-muted text-sm mb-2">Failed to load</p>
            <button onClick={() => setRetry(n => n + 1)} className="text-xs text-primary underline">Retry</button>
          </div>
        ) : brands.length === 0 ? (
          <p className="text-center text-text-muted text-sm py-8">No brands yet</p>
        ) : (
          <div className="space-y-1.5 overflow-y-auto flex-1">
            {brands.map(b => (
              <div key={b.id} onClick={() => setSelectedBrand(b)}
                className={cn(
                  'flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors border',
                  selectedBrand?.id === b.id ? 'border-l-2 border-l-primary border-y-border border-r-border bg-primary/5' : 'border-border-light hover:bg-surface-2'
                )}>
                <div>
                  <p className="text-sm font-semibold text-text-primary">{b.name}</p>
                  <p className="text-xs text-text-muted">{b.model_count} model{b.model_count !== 1 ? 's' : ''}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Toggle checked={b.is_active} onChange={() => toggleBrandActive(b)} />
                  <button onClick={e => { e.stopPropagation(); setFormVals({ name: b.name, is_active: b.is_active }); setEditBrand(b) }}
                    className="text-xs text-text-muted hover:text-primary transition-colors">Edit</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Models panel */}
      <div className="flex-1 admin-card">
        {!selectedBrand ? (
          <div className="py-20 text-center text-text-muted text-sm">Select a brand to view models</div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-text-primary">{selectedBrand.name} — Models</h2>
              <button onClick={() => { setFormVals({ name: '', typical_category_id: '', is_active: true }); setAddModelOpen(true) }}
                className="px-3 py-1 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary-dark">
                + Add Model
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead><tr><th>Model Name</th><th>Typical Category</th><th>Active</th><th></th></tr></thead>
                <tbody>
                  {modelsLoading ? <SkeletonRows cols={4} /> :
                   models.length === 0 ? <EmptyState message="No models for this brand" /> :
                   models.map(m => (
                    <tr key={m.id}>
                      <td className="font-medium text-text-primary">{m.name}</td>
                      <td><span className="text-text-secondary text-sm">{m.typical_category_name ?? '—'}</span></td>
                      <td><Toggle checked={m.is_active} onChange={() => toggleModelActive(m)} /></td>
                      <td>
                        <button onClick={() => { setFormVals({ name: m.name, typical_category_id: m.typical_category_id ?? '', is_active: m.is_active }); setEditModel(m) }}
                          className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2">Edit</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Brand dialogs */}
      <FieldDialog open={addBrandOpen} title="Add Brand"
        fields={[{ key: 'name', label: 'Brand Name', type: 'text' }, { key: 'is_active', label: 'Active', type: 'toggle' }]}
        values={formVals} onChange={(k, v) => setFormVals(p => ({ ...p, [k]: v }))}
        loading={saving} onCancel={() => setAddBrandOpen(false)} onConfirm={handleAddBrand} confirmLabel="Add Brand"
      />
      <FieldDialog open={!!editBrand} title={`Edit — ${editBrand?.name}`}
        fields={[{ key: 'name', label: 'Brand Name', type: 'text' }, { key: 'is_active', label: 'Active', type: 'toggle' }]}
        values={formVals} onChange={(k, v) => setFormVals(p => ({ ...p, [k]: v }))}
        loading={saving} onCancel={() => setEditBrand(null)} onConfirm={handleEditBrand}
      />

      {/* Model dialogs — use native select for category */}
      <Dialog.Root open={addModelOpen} onOpenChange={v => { if (!v) setAddModelOpen(false) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[420px]">
            <Dialog.Title className="text-lg font-bold text-text-primary mb-5">Add Model</Dialog.Title>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Model Name</label>
                <input value={String(formVals.name ?? '')} onChange={e => setFormVals(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Typical Category</label>
                <select value={String(formVals.typical_category_id ?? '')} onChange={e => setFormVals(p => ({ ...p, typical_category_id: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">— None —</option>
                  {categoryOptions.map(o => { const [id, name] = o.split(':'); return <option key={id} value={id}>{name}</option> })}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">Active</label>
                <Toggle checked={!!formVals.is_active} onChange={v => setFormVals(p => ({ ...p, is_active: v }))} />
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setAddModelOpen(false)} className="px-4 py-2 text-sm border border-border rounded-xl hover:bg-surface-2">Cancel</button>
              <button onClick={handleAddModel} disabled={saving}
                className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-dark disabled:opacity-50">
                {saving ? 'Saving…' : 'Add Model'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={!!editModel} onOpenChange={v => { if (!v) setEditModel(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-text-primary/40 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-surface rounded-2xl shadow-hover p-6 w-full max-w-[420px]">
            <Dialog.Title className="text-lg font-bold text-text-primary mb-5">Edit Model</Dialog.Title>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Model Name</label>
                <input value={String(formVals.name ?? '')} onChange={e => setFormVals(p => ({ ...p, name: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Typical Category</label>
                <select value={String(formVals.typical_category_id ?? '')} onChange={e => setFormVals(p => ({ ...p, typical_category_id: e.target.value }))}
                  className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface-2 focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">— None —</option>
                  {categoryOptions.map(o => { const [id, name] = o.split(':'); return <option key={id} value={id}>{name}</option> })}
                </select>
              </div>
              <div className="flex items-center gap-3">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">Active</label>
                <Toggle checked={!!formVals.is_active} onChange={v => setFormVals(p => ({ ...p, is_active: v }))} />
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button onClick={() => setEditModel(null)} className="px-4 py-2 text-sm border border-border rounded-xl hover:bg-surface-2">Cancel</button>
              <button onClick={handleEditModel} disabled={saving}
                className="px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-dark disabled:opacity-50">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FLEET TAB
// ══════════════════════════════════════════════════════════════════════════════

function FleetTab() {
  const [data, setData] = useState<FleetVehicle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')
  const [blacklistTarget, setBlacklistTarget] = useState<FleetVehicle | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try { setData(await fleetApi.list(statusFilter || undefined)) }
    catch { setError(true) }
    finally { setLoading(false) }
  }, [statusFilter, retry]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  async function handleBlacklist(reason: string) {
    if (!blacklistTarget) return
    setActionLoading(true)
    try {
      await fleetApi.blacklist(blacklistTarget.id, reason)
      setBlacklistTarget(null)
      await load()
    } catch { } finally { setActionLoading(false) }
  }

  async function handleUnblacklist(v: FleetVehicle) {
    try {
      await fleetApi.unblacklist(v.id)
      setData(prev => prev.map(x => x.id === v.id ? { ...x, status: 'active' } : x))
    } catch { }
  }

  const total = data.length
  const active = data.filter(v => v.status === 'active').length
  const blacklisted = data.filter(v => v.status === 'blacklisted').length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="Total Vehicles" value={total} change="All time" changeType="neutral" icon={Car} gradient="blue" />
        <StatCard title="Active" value={active} change="On road" changeType="up" icon={CheckCircle} gradient="green" />
        <StatCard title="Blacklisted" value={blacklisted} change="Blocked" changeType="neutral" icon={XCircle} gradient="purple" />
      </div>

      <div className="admin-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-text-primary">Fleet</h2>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="border border-border rounded-xl px-3 py-2 text-sm bg-surface-2 focus:outline-none">
            <option value="">All Statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="blacklisted">Blacklisted</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr>
              <th>Driver</th><th>Vehicle</th><th>Plate</th>
              <th>Category</th><th>Status</th><th>Registered</th><th></th>
            </tr></thead>
            <tbody>
              {loading ? <SkeletonRows cols={7} /> :
               error   ? <ErrorState onRetry={() => setRetry(n => n + 1)} /> :
               data.length === 0 ? <EmptyState message="No vehicles match filters" /> :
               data.map(v => (
                <tr key={v.id}>
                  <td>
                    <p className="font-semibold text-text-primary">{v.driver_name ?? '—'}</p>
                    <p className="text-xs text-text-muted font-mono">{v.driver_code}</p>
                  </td>
                  <td className="text-text-secondary">{v.vehicle_name ?? '—'}</td>
                  <td><span className="font-mono text-xs font-bold text-text-primary">{v.number_plate ?? '—'}</span></td>
                  <td><span className="text-text-secondary text-sm">{v.category ?? '—'}</span></td>
                  <td><StatusPill status={v.status} /></td>
                  <td className="text-text-muted text-xs">{fmt(v.created_at)}</td>
                  <td>
                    <div className="flex gap-1.5">
                      {v.status === 'active' && (
                        <button onClick={() => setBlacklistTarget(v)}
                          className="px-2 py-1 text-xs font-semibold border border-danger text-danger rounded-lg hover:bg-danger-light transition-colors">
                          Blacklist
                        </button>
                      )}
                      {v.status === 'blacklisted' && (
                        <button onClick={() => handleUnblacklist(v)}
                          className="px-2 py-1 text-xs font-semibold bg-success text-white rounded-lg hover:bg-emerald-600 transition-colors">
                          Unblacklist
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ReasonDialog
        open={!!blacklistTarget}
        title="Blacklist Vehicle"
        description={`Blacklist ${blacklistTarget?.number_plate ?? 'this vehicle'}? If this is the driver's primary vehicle, they will be suspended.`}
        confirmLabel="Blacklist Vehicle"
        variant="danger"
        loading={actionLoading}
        onCancel={() => setBlacklistTarget(null)}
        onConfirm={handleBlacklist}
      />
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENTS TAB
// ══════════════════════════════════════════════════════════════════════════════

function DocumentsTab() {
  const [pending, setPending] = useState<PendingVehicleDoc[]>([])
  const [expiring, setExpiring] = useState<ExpiringVehicleDoc[]>([])
  const [loadingP, setLoadingP] = useState(true)
  const [loadingE, setLoadingE] = useState(true)
  const [errorP, setErrorP] = useState(false)
  const [errorE, setErrorE] = useState(false)
  const [retryP, setRetryP] = useState(0)
  const [retryE, setRetryE] = useState(0)
  const [rejectTarget, setRejectTarget] = useState<PendingVehicleDoc | null>(null)
  const [actionLoading, setActionLoading] = useState(false)

  useEffect(() => {
    setLoadingP(true); setErrorP(false)
    vehicleDocApi.listPending()
      .then(setPending).catch(() => setErrorP(true)).finally(() => setLoadingP(false))
  }, [retryP])

  useEffect(() => {
    setLoadingE(true); setErrorE(false)
    vehicleDocApi.listExpiring(30)
      .then(setExpiring).catch(() => setErrorE(true)).finally(() => setLoadingE(false))
  }, [retryE])

  async function handleApprove(doc: PendingVehicleDoc) {
    try {
      await vehicleDocApi.approve(doc.id)
      setPending(prev => prev.filter(d => d.id !== doc.id))
    } catch { }
  }

  async function handleReject(note: string) {
    if (!rejectTarget) return
    setActionLoading(true)
    try {
      await vehicleDocApi.reject(rejectTarget.id, note)
      setPending(prev => prev.filter(d => d.id !== rejectTarget.id))
      setRejectTarget(null)
    } catch { } finally { setActionLoading(false) }
  }

  return (
    <div className="space-y-6">
      {/* Pending review */}
      <div className="admin-card">
        <h2 className="text-base font-bold text-text-primary mb-1">Pending Review</h2>
        {!loadingP && pending.length > 0 && (
          <div className="bg-warning-light border border-warning/20 rounded-xl px-4 py-2.5 mb-3 text-sm font-semibold text-warning">
            ⚡ {pending.length} document{pending.length > 1 ? 's' : ''} awaiting review
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Driver</th><th>Vehicle</th><th>Doc Type</th><th>Uploaded</th><th>Actions</th></tr></thead>
            <tbody>
              {loadingP ? <SkeletonRows cols={5} /> :
               errorP   ? <ErrorState onRetry={() => setRetryP(n => n + 1)} /> :
               pending.length === 0 ? <EmptyState message="No pending vehicle documents" /> :
               pending.map(doc => (
                <tr key={doc.id}>
                  <td>
                    <p className="font-semibold text-text-primary">{doc.driver_name ?? '—'}</p>
                    <p className="text-xs text-text-muted font-mono">{doc.driver_code}</p>
                  </td>
                  <td>
                    <p className="text-sm text-text-primary font-mono">{doc.number_plate ?? '—'}</p>
                    <p className="text-xs text-text-muted">{doc.vehicle_name ?? ''}</p>
                  </td>
                  <td><span className="text-sm text-text-secondary">{docLabel(doc.doc_type)}</span></td>
                  <td className="text-text-muted text-xs">{fmt(doc.created_at)}</td>
                  <td>
                    <div className="flex gap-2 items-center">
                      <a href={doc.file_url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">View</a>
                      <button onClick={() => handleApprove(doc)}
                        className="px-2 py-1 text-xs font-semibold bg-success text-white rounded-lg hover:bg-emerald-600 transition-colors">
                        Approve
                      </button>
                      <button onClick={() => setRejectTarget(doc)}
                        className="px-2 py-1 text-xs font-semibold border border-danger text-danger rounded-lg hover:bg-danger-light transition-colors">
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Expiring soon */}
      <div className="admin-card">
        <h2 className="text-base font-bold text-text-primary mb-3">Expiring Soon (30 days)</h2>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead><tr><th>Driver</th><th>Vehicle</th><th>Doc Type</th><th>Expires</th><th>Days Left</th></tr></thead>
            <tbody>
              {loadingE ? <SkeletonRows cols={5} /> :
               errorE   ? <ErrorState onRetry={() => setRetryE(n => n + 1)} /> :
               expiring.length === 0 ? <EmptyState message="No documents expiring in the next 30 days" /> :
               expiring.map(doc => {
                const days = daysLeft(doc.valid_until)
                return (
                  <tr key={doc.id}>
                    <td>
                      <p className="font-semibold text-text-primary">{doc.driver_name ?? '—'}</p>
                      <p className="text-xs text-text-muted">{doc.driver_phone}</p>
                    </td>
                    <td><span className="font-mono text-xs text-text-primary">{doc.number_plate ?? '—'}</span></td>
                    <td><span className="text-sm text-text-secondary">{docLabel(doc.doc_type)}</span></td>
                    <td className="text-text-muted text-xs">{fmt(doc.valid_until)}</td>
                    <td>
                      <span className={cn('text-sm font-bold',
                        days <= 7 ? 'text-danger' : days <= 14 ? 'text-warning' : 'text-success'
                      )}>
                        {days}d
                      </span>
                    </td>
                  </tr>
                )
               })}
            </tbody>
          </table>
        </div>
      </div>

      <ReasonDialog
        open={!!rejectTarget}
        title="Reject Document"
        description={`Reject ${rejectTarget ? docLabel(rejectTarget.doc_type) : ''} for ${rejectTarget?.driver_name ?? rejectTarget?.driver_code ?? ''}?`}
        confirmLabel="Reject"
        variant="danger"
        loading={actionLoading}
        onCancel={() => setRejectTarget(null)}
        onConfirm={handleReject}
      />
    </div>
  )
}
