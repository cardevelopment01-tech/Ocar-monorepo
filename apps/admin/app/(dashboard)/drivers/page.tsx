'use client'
import React, { Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, UserCheck, Clock, ShieldOff, MapPin, X } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import ReasonDialog from '@/components/ui/ReasonDialog'
import SuccessToast from '@/components/ui/SuccessToast'
import { adminDriverApi, type DriverListItem, type DriverListSummary, type DriverListFacets } from '@/lib/admin-api'
import { cityApi, type AdminCity } from '@/lib/city-api'
import { vehicleCategoryApi, type VehicleCategory } from '@/lib/vehicle-api'
import { cn } from '@/lib/utils'
import { InitialsAvatar, fmt } from './shared'

// ─── Skeleton ────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-light last:border-b-0">
          {Array.from({ length: 9 }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: j === 0 ? 140 : j === 8 ? 60 : 80 }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// Only actions reachable from the pending-approval banner's fast path.
// Suspend/reinstate/ban-from-active live on the driver detail page's
// persistent action bar now.
type ActionType = 'approve' | 'rejectDocs' | 'ban'
interface PendingAction { type: ActionType; driverId: string; driverName: string }
const LIMIT = 20

const csv = (v: string | null) => (v ? v.split(',').filter(Boolean) : [])
const EMPTY_SUMMARY: DriverListSummary = { total: 0, active: 0, pending_approval: 0, suspended: 0 }
const EMPTY_FACETS: DriverListFacets = { cities: {}, categories: {} }

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1.5 bg-primary-light text-primary text-xs font-semibold rounded-full pl-3 pr-1.5 py-1">
      {label}
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-primary/15">
        <X size={11} aria-hidden />
      </button>
    </span>
  )
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="py-12 text-center">
      <p className="text-sm text-text-secondary mb-3">{message}</p>
      <button type="button" onClick={onRetry} className="px-3 py-1.5 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors">Retry</button>
    </div>
  )
}

export default function DriversPage() {
  return (
    <Suspense fallback={<div className="admin-card h-64 animate-pulse" />}>
      <DriversPageInner />
    </Suspense>
  )
}

function DriversPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  // Filters live in the URL so Back from a driver restores the view and links are shareable.
  const cityIds     = csv(searchParams.get('city'))
  const vehicleIds  = csv(searchParams.get('vehicle'))
  const statusFilter = searchParams.get('status') ?? ''
  const urlSearch   = searchParams.get('q') ?? ''
  const page        = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1)

  const setParams = useCallback((updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v); else next.delete(k)
    }
    if (!('page' in updates)) next.delete('page')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [searchParams, router, pathname])

  const [drivers, setDrivers]             = useState<DriverListItem[]>([])
  const [total, setTotal]                 = useState(0)
  const [pages, setPages]                 = useState(1)
  const [summary, setSummary]             = useState<DriverListSummary>(EMPTY_SUMMARY)
  const [facets, setFacets]               = useState<DriverListFacets>(EMPTY_FACETS)
  const [hasLoaded, setHasLoaded]         = useState(false)
  const [listLoading, setListLoading]     = useState(true)
  const [listError, setListError]         = useState(false)

  const [pendingRows, setPendingRows]     = useState<DriverListItem[]>([])
  const [bannerError, setBannerError]     = useState(false)

  const [cities, setCities]               = useState<AdminCity[]>([])
  const [categories, setCategories]       = useState<VehicleCategory[]>([])

  const [search, setSearch]               = useState(urlSearch)
  const debounceRef                       = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionError, setActionError]     = useState('')
  const [successMsg, setSuccessMsg]       = useState<string | null>(null)

  useEffect(() => {
    cityApi.list().then(setCities).catch(() => setCities([]))
    vehicleCategoryApi.list().then(setCategories).catch(() => setCategories([]))
  }, [])

  // ── debounce search into the URL ───────────────────────────────────────────
  const pushedSearch = useRef(urlSearch)
  useEffect(() => {
    if (search === urlSearch) return
    debounceRef.current = setTimeout(() => { pushedSearch.current = search; setParams({ q: search || null }) }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search, urlSearch, setParams])
  // keep the box in sync when the URL changes from outside (Back, Clear filters),
  // but not for our own push, which would clobber keystrokes typed meanwhile
  useEffect(() => {
    if (urlSearch !== pushedSearch.current) { pushedSearch.current = urlSearch; setSearch(urlSearch) }
  }, [urlSearch])

  // ── fetch list: latest request wins, so a slow older response never overwrites a newer one ──
  const listReq = useRef(0)
  const bannerReq = useRef(0)
  const cityParam = cityIds.join(',')
  const vehicleParam = vehicleIds.join(',')

  const fetchList = useCallback(async () => {
    const n = ++listReq.current
    setListLoading(true)
    try {
      const res = await adminDriverApi.list({
        status: statusFilter || undefined, search: urlSearch || undefined,
        city: cityParam || undefined, vehicle: vehicleParam || undefined, page, limit: LIMIT,
      })
      if (n !== listReq.current) return
      setDrivers(res.drivers); setTotal(res.pagination.total); setPages(res.pagination.pages)
      setSummary(res.summary); setFacets(res.facets)
      setListError(false); setHasLoaded(true)
    } catch {
      if (n !== listReq.current) return
      setListError(true)
    } finally {
      if (n === listReq.current) setListLoading(false)
    }
  }, [statusFilter, urlSearch, cityParam, vehicleParam, page])

  // the approval banner has its own request so it never depends on the current page
  const fetchBanner = useCallback(async () => {
    const n = ++bannerReq.current
    try {
      const res = await adminDriverApi.list({
        status: 'pending_approval', city: cityParam || undefined, vehicle: vehicleParam || undefined, limit: 50,
      })
      if (n !== bannerReq.current) return
      setPendingRows(res.drivers); setBannerError(false)
    } catch {
      if (n === bannerReq.current) setBannerError(true)
    }
  }, [cityParam, vehicleParam])

  useEffect(() => { fetchList() }, [fetchList])
  useEffect(() => { fetchBanner() }, [fetchBanner])

  // ── inline banner actions (fast path — no navigation required) ────────────
  function openAction(type: ActionType, driver: DriverListItem) {
    setPendingAction({ type, driverId: driver.id, driverName: driver.full_name ?? driver.phone })
  }
  async function executeAction(reason?: string) {
    if (!pendingAction) return
    setActionLoading(true); setActionError('')
    try {
      const { type, driverId } = pendingAction
      if (type === 'approve')     await adminDriverApi.approve(driverId)
      if (type === 'rejectDocs')  await adminDriverApi.rejectDocs(driverId, reason!)
      if (type === 'ban')         await adminDriverApi.ban(driverId, reason!)
      setPendingAction(null)
      await Promise.all([fetchList(), fetchBanner()])
      setSuccessMsg(type === 'approve' ? 'Driver activated' : type === 'rejectDocs' ? 'Documents rejected' : 'Driver banned')
    } catch (err) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      setActionError(message ?? 'Action failed. Please try again.')
    }
    finally { setActionLoading(false) }
  }

  // ── derived ────────────────────────────────────────────────────────────────
  const cityName = (id: string) => id === 'none' ? 'Not assigned' : cities.find(c => String(c.id) === id)?.name ?? `City #${id}`
  const categoryName = (id: string) => categories.find(c => c.id === id)?.display_name ?? `Vehicle #${id}`
  const cityOptions = useMemo(() => [
    ...cities.map(c => ({ value: String(c.id), label: c.name, count: facets.cities[String(c.id)] ?? 0 })),
    { value: 'none', label: 'Not assigned', count: facets.cities['none'] ?? 0 },
  ], [cities, facets])
  const vehicleOptions = useMemo(
    () => categories.map(c => ({ value: c.id, label: c.display_name, count: facets.categories[c.id] ?? 0 })),
    [categories, facets])
  const hasFilters = cityIds.length > 0 || vehicleIds.length > 0 || !!statusFilter || !!urlSearch
  const clearFilters = () => { setSearch(''); setParams({ city: null, vehicle: null, status: null, q: null }) }
  const emptyMessage = !hasFilters ? 'No drivers yet' : 'No drivers' +
    (cityIds.length ? ` in ${cityIds.map(cityName).join(', ')}` : '') +
    (vehicleIds.length ? ` with ${vehicleIds.map(categoryName).join(', ')} vehicles` : '') +
    (statusFilter ? ` with status ${statusFilter.replace(/_/g, ' ')}` : '') +
    (urlSearch ? ` matching "${urlSearch}"` : '')
  const cardsLoading = listLoading && !hasLoaded

  // ── table columns ──────────────────────────────────────────────────────────
  const columns = [
    {
      key: 'name', header: 'Driver',
      render: (d: DriverListItem) => (
        <div className="flex items-center gap-2.5">
          <InitialsAvatar name={d.full_name ?? d.phone} />
          <div>
            <p className="font-semibold text-text-primary">{d.full_name ?? '—'}</p>
            <p className="text-xs text-text-muted">{d.email ?? d.phone}</p>
          </div>
        </div>
      ),
    },
    { key: 'code',  header: 'Code',  render: (d: DriverListItem) => <span className="font-mono text-xs text-primary">{d.code}</span> },
    { key: 'phone', header: 'Phone', render: (d: DriverListItem) => <span className="text-text-secondary">{d.phone}</span> },
    {
      key: 'vehicle', header: 'Vehicle',
      render: (d: DriverListItem) => d.vehicle ? (
        <div>
          <p className="text-text-primary font-medium font-mono text-xs">{d.vehicle.number_plate}</p>
          <StatusPill status={d.vehicle.category.toLowerCase()} />
        </div>
      ) : <span className="text-text-muted">—</span>,
    },
    {
      key: 'city', header: 'City',
      render: (d: DriverListItem) => d.city ? (
        <span className="inline-flex items-center gap-1.5 text-text-secondary"><MapPin size={12} className="text-text-muted" aria-hidden />{d.city.name}</span>
      ) : <span className="text-text-muted italic">Not assigned</span>,
    },
    { key: 'status', header: 'Status', render: (d: DriverListItem) => <StatusPill status={d.status} /> },
    {
      key: 'docs', header: 'Docs',
      render: (d: DriverListItem) => (
        <span className={cn('text-xs font-semibold',
          d.docs_approved === d.docs_submitted && d.docs_submitted > 0 ? 'text-success' : 'text-text-secondary'
        )}>
          {d.docs_approved}/{d.docs_submitted}
        </span>
      ),
    },
    { key: 'joined', header: 'Joined', render: (d: DriverListItem) => <span className="text-text-muted text-xs">{fmt(d.created_at)}</span> },
    {
      key: 'actions', header: '',
      render: (d: DriverListItem) => (
        <button
          onClick={e => { e.stopPropagation(); router.push(`/drivers/${d.id}`) }}
          className="px-3 py-1 text-xs font-semibold border border-border rounded-lg hover:bg-surface-2 transition-colors text-text-secondary"
        >
          Review
        </button>
      ),
    },
  ]

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      <SuccessToast message={successMsg} onDismiss={() => setSuccessMsg(null)} />

      {/* Stat cards: scoped to the current filters, counted server-side */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Drivers"    value={summary.total}            change={hasFilters ? 'Current filters' : 'All time'} changeType="neutral" icon={Users}    gradient="blue"   loading={cardsLoading} />
        <StatCard title="Active"           value={summary.active}           change="Ready to drive"  changeType="neutral" icon={UserCheck} gradient="green"  loading={cardsLoading} />
        <StatCard title="Pending Approval" value={summary.pending_approval} change="Needs attention" changeType="neutral" icon={Clock}    gradient="amber"  loading={cardsLoading} />
        <StatCard title="Suspended"        value={summary.suspended}        change="Under review"    changeType="neutral" icon={ShieldOff} gradient="purple" loading={cardsLoading} />
      </div>

      {bannerError && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-warning-light border border-warning/20 rounded-2xl px-4 py-3 text-sm text-text-secondary">
          Couldn&apos;t load drivers awaiting approval.
          <button type="button" onClick={fetchBanner} className="px-3 py-1 text-xs font-semibold border border-border rounded-lg bg-surface hover:bg-surface-2">Retry</button>
        </div>
      )}

      {/* Pending approval banner */}
      <AnimatePresence initial={false}>
        {pendingRows.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="bg-warning-light border border-warning/20 rounded-2xl p-4">
              <p className="text-sm font-bold text-warning mb-3">
                ⚡ {pendingRows.length} driver{pendingRows.length > 1 ? 's' : ''} awaiting approval
              </p>
              <table className="data-table">
                <thead><tr><th>Driver</th><th>Phone</th><th>Vehicle</th><th>Applied</th><th>Actions</th></tr></thead>
                <tbody>
                  {pendingRows.map(d => (
                    <tr key={d.id} className="group">
                      <td className="font-semibold text-text-primary">{d.full_name ?? '—'}</td>
                      <td>{d.phone}</td>
                      <td>{d.vehicle?.number_plate ?? '—'}</td>
                      <td className="text-text-muted">{fmt(d.created_at)}</td>
                      <td>
                        <div className="flex gap-2">
                          <button onClick={() => openAction('approve', d)} className="px-3 py-1 text-xs font-semibold bg-success text-white rounded-lg hover:bg-emerald-600 transition-colors">Activate</button>
                          <button
                            onClick={() => router.push(`/drivers/${d.id}?tab=documents`)}
                            className="px-3 py-1 text-xs font-semibold border border-primary text-primary rounded-lg hover:bg-primary-light transition-colors"
                          >
                            Review Docs
                          </button>
                          <button onClick={() => openAction('rejectDocs', d)} className="px-3 py-1 text-xs font-semibold border border-warning text-warning rounded-lg hover:bg-warning/8 transition-colors">Reject Docs</button>
                          <button onClick={() => openAction('ban', d)} className="px-3 py-1 text-xs font-semibold border border-danger text-danger rounded-lg hover:bg-danger-light transition-colors">Ban</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main table */}
      <div className="admin-card">
        <div className="mb-4 space-y-3">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by name, phone, or code…"
            wrapSearch
            leading={<>
              <MultiSelectFilter
                label="City" options={cityOptions} selected={cityIds} searchable searchPlaceholder="Search cities…"
                onChange={v => setParams({ city: v.join(',') || null })}
              />
              <MultiSelectFilter
                label="Vehicle type" options={vehicleOptions} selected={vehicleIds}
                onChange={v => setParams({ vehicle: v.join(',') || null })}
              />
            </>}
            filters={[{
              key: 'status', label: 'All Statuses',
              options: [
                { value: 'active',           label: 'Active' },
                { value: 'pending_approval', label: 'Pending Approval' },
                { value: 'docs_rejected',    label: 'Docs Rejected' },
                { value: 'suspended',        label: 'Suspended' },
                { value: 'pending_docs',     label: 'Pending Docs' },
              ],
              value: statusFilter,
              onChange: v => setParams({ status: v || null }),
            }]}
          />
          {(cityIds.length > 0 || vehicleIds.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              {cityIds.map(id => (
                <FilterChip key={`c${id}`} label={`City: ${cityName(id)}`} onRemove={() => setParams({ city: cityIds.filter(x => x !== id).join(',') || null })} />
              ))}
              {vehicleIds.map(id => (
                <FilterChip key={`v${id}`} label={`Vehicle: ${categoryName(id)}`} onRemove={() => setParams({ vehicle: vehicleIds.filter(x => x !== id).join(',') || null })} />
              ))}
              <button type="button" onClick={clearFilters} className="text-xs font-medium text-text-secondary hover:text-text-primary underline underline-offset-2">Clear filters</button>
            </div>
          )}
        </div>

        {listError ? (
          <InlineError message="Couldn't load drivers." onRetry={fetchList} />
        ) : !hasLoaded ? (
          <table className="data-table w-full"><tbody><SkeletonRows /></tbody></table>
        ) : drivers.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-text-muted text-sm">{emptyMessage}</p>
            {hasFilters && (
              <button type="button" onClick={clearFilters} className="mt-3 px-4 py-2 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-dark transition-colors">Clear filters</button>
            )}
          </div>
        ) : (
          <div aria-busy={listLoading} className={cn('transition-opacity', listLoading && 'opacity-50')}>
            <DataTable
              pinFirstColumn
              columns={columns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
              data={drivers as unknown as Record<string, unknown>[]}
              onRowClick={row => router.push(`/drivers/${(row as unknown as DriverListItem).id}`)}
              emptyMessage={emptyMessage}
            />
          </div>
        )}

        {pages > 1 && !listError && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-light">
            <p className="text-xs text-text-muted">Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1}     onClick={() => setParams({ page: String(page - 1) })} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Previous</button>
              <button disabled={page >= pages} onClick={() => setParams({ page: String(page + 1) })} className="px-3 py-1 text-xs font-medium border border-border rounded-lg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Approve confirm */}
      <ConfirmDialog
        open={pendingAction?.type === 'approve'}
        onOpenChange={v => { if (!v) { setPendingAction(null); setActionError('') } }}
        title="Activate Driver"
        description={actionError || `Activate ${pendingAction?.driverName} as an active driver?`}
        confirmLabel={actionLoading ? 'Submitting…' : 'Activate'}
        variant={actionError ? 'danger' : 'success'}
        onConfirm={() => { if (!actionLoading) executeAction() }}
      />

      {/* Reject docs: recoverable, driver can fix and resubmit */}
      <ReasonDialog
        open={pendingAction?.type === 'rejectDocs'}
        title="Reject Documents"
        description={`Tell ${pendingAction?.driverName ?? ''} what needs to be fixed. They will be asked to re-upload and resubmit.`}
        confirmLabel="Reject Docs"
        variant="warning"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />

      {/* Ban: permanent */}
      <ReasonDialog
        open={pendingAction?.type === 'ban'}
        title="Ban Driver"
        description={`Permanently ban ${pendingAction?.driverName ?? ''}? This cannot be undone.`}
        confirmLabel="Ban Driver"
        variant="danger"
        loading={actionLoading}
        onCancel={() => setPendingAction(null)}
        onConfirm={reason => executeAction(reason)}
      />
    </div>
  )
}
