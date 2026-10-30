'use client'
import React, { Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Users, UserCheck, Clock, ShieldOff, MapPin, X, MoreHorizontal } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import MultiSelectFilter from '@/components/ui/MultiSelectFilter'
import ReasonDialog from '@/components/ui/ReasonDialog'
import SuccessToast from '@/components/ui/SuccessToast'
import { adminDriverApi, type DriverListItem, type DriverListSummary, type DriverListFacets } from '@/lib/admin-api'
import { cityApi, type AdminCity } from '@/lib/city-api'
import { vehicleCategoryApi, type VehicleCategory } from '@/lib/vehicle-api'
import { cn } from '@/lib/utils'
import { InitialsAvatar, fmt } from './shared'
import { extractErrorMessage } from '@/lib/http-errors'

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

// Only the actions reachable from a pending row's overflow menu. Approving needs the
// documents in front of you, so it lives on the driver page; suspend/reinstate too.
type ActionType = 'rejectDocs' | 'ban'
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


// How long an applicant has been waiting; amber after two days, red after a week, so red stays rare.
function waiting(iso: string): { label: string; cls: string } {
  const h = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000))
  const label = h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
  return { label, cls: h >= 168 ? 'text-danger' : h >= 48 ? 'text-warning' : 'text-text-secondary' }
}

function StatusTabs({ tabs, value, onChange }: {
  tabs: { value: string; label: string; count?: number; alert?: boolean }[]
  value: string
  onChange: (v: string) => void
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  // WAI-ARIA tabs: roving tabindex + arrows/Home/End (same idiom as ReportTabs)
  function onKeyDown(e: React.KeyboardEvent) {
    const i = Math.max(0, tabs.findIndex(t => t.value === value))
    const next = e.key === 'ArrowRight' ? (i + 1) % tabs.length
      : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1
    if (next < 0) return
    e.preventDefault()
    const t = tabs[next]!
    onChange(t.value)
    refs.current[t.value]?.focus()
  }
  return (
    <div role="tablist" aria-label="Driver status" onKeyDown={onKeyDown} className="flex gap-1 border-b border-border-light mb-4 -mt-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]">
      {tabs.map(t => {
        const on = t.value === value
        return (
          <button
            key={t.value} ref={el => { refs.current[t.value] = el }} role="tab" type="button" aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.value)}
            className={cn(
              'relative -mb-px px-3 py-2.5 text-sm font-semibold whitespace-nowrap inline-flex items-center gap-2 border-b-2 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-t-lg',
              on ? 'text-primary border-primary' : 'text-text-muted border-transparent hover:text-text-primary',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn('min-w-[22px] px-1.5 rounded-full text-[11px] font-bold leading-5 text-center tabular-nums',
                t.alert && t.count > 0 ? 'bg-warning-light text-warning' : 'bg-surface-2 text-text-muted')}>
                {t.count}
              </span>
            )}
          </button>
        )
      })}
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

  useEffect(() => { fetchList() }, [fetchList])

  // ── row overflow actions (reject docs / ban) ──────────────────────────────
  function openAction(type: ActionType, driver: DriverListItem) {
    setPendingAction({ type, driverId: driver.id, driverName: driver.full_name ?? driver.phone })
  }
  async function executeAction(reason?: string) {
    if (!pendingAction) return
    setActionLoading(true); setActionError('')
    try {
      const { type, driverId } = pendingAction
      if (type === 'rejectDocs')  await adminDriverApi.rejectDocs(driverId, reason!)
      if (type === 'ban')         await adminDriverApi.ban(driverId, reason!)
      setPendingAction(null)
      await fetchList()
      setSuccessMsg(type === 'rejectDocs' ? 'Documents rejected' : 'Driver banned')
    } catch (err) {
      setActionError(extractErrorMessage(err, 'Action failed. Please try again.'))
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
  const inQueue = statusFilter === 'pending_approval'
  const tabOwnsStatus = inQueue || statusFilter === 'suspended' // those statuses are tabs, not dropdown options
  const hasFilters = cityIds.length > 0 || vehicleIds.length > 0 || !!statusFilter || !!urlSearch
  const clearFilters = () => { setSearch(''); setParams({ city: null, vehicle: null, status: null, q: null }) }
  const emptyMessage = inQueue && !urlSearch && !cityIds.length && !vehicleIds.length ? 'All caught up. No drivers are waiting for approval.' : !hasFilters ? 'No drivers yet' : 'No drivers' +
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

  // Approval queue: oldest first (server-side), with wait time and one clear next step.
  const queueColumns = [
    {
      key: 'name', header: 'Applicant',
      render: (d: DriverListItem) => (
        <div className="flex items-center gap-2.5">
          <InitialsAvatar name={d.full_name ?? d.phone} />
          <div>
            <p className="font-semibold text-text-primary">{d.full_name ?? '—'}</p>
            <p className="text-xs text-text-muted">{d.phone}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'vehicle', header: 'Vehicle',
      render: (d: DriverListItem) => d.vehicle ? (
        <div>
          <p className="font-mono text-xs font-medium text-text-primary">{d.vehicle.number_plate}</p>
          <p className="text-xs text-text-muted">{d.vehicle.category}</p>
        </div>
      ) : <span className="text-text-muted">—</span>,
    },
    {
      key: 'docs', header: 'Documents',
      render: (d: DriverListItem) => (
        <span className="inline-flex items-center gap-2 text-xs font-semibold text-text-secondary tabular-nums">
          {d.docs_approved}/{d.docs_submitted}
          <span className="h-1 w-12 rounded-full bg-surface-2 overflow-hidden" aria-hidden>
            <span className="block h-full bg-success" style={{ width: `${d.docs_submitted ? (d.docs_approved / d.docs_submitted) * 100 : 0}%` }} />
          </span>
        </span>
      ),
    },
    {
      key: 'waiting', header: 'Waiting',
      render: (d: DriverListItem) => {
        const since = d.queued_at ?? d.created_at
        const w = waiting(since)
        return <span className={cn('text-sm font-semibold tabular-nums', w.cls)} title={`In the queue since ${fmt(since)}`}>{w.label}</span>
      },
    },
    {
      key: 'actions', header: '',
      render: (d: DriverListItem) => (
        <div className="flex items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => router.push(`/drivers/${d.id}?tab=documents`)}
            className="px-3.5 py-1.5 text-xs font-semibold bg-primary text-white rounded-lg hover:bg-primary-dark active:scale-[0.97] transition-[background-color,transform] duration-150"
          >
            Review
          </button>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" aria-label={`More actions for ${d.full_name ?? d.phone}`}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-text-muted hover:bg-surface-2 hover:text-text-primary transition-colors">
                <MoreHorizontal size={16} aria-hidden />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={6}
                className="z-50 bg-surface border border-border rounded-xl py-1 min-w-[168px] animate-fade-in"
                style={{ boxShadow: '0 8px 32px rgba(15,23,42,0.12), 0 0 0 1px #DCEBEE' }}>
                <DropdownMenu.Item onSelect={() => openAction('rejectDocs', d)}
                  className="px-3 py-2 mx-1 rounded-lg text-sm font-medium text-text-secondary cursor-pointer outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-text-primary">
                  Reject documents…
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => openAction('ban', d)}
                  className="px-3 py-2 mx-1 rounded-lg text-sm font-medium text-danger cursor-pointer outline-none data-[highlighted]:bg-danger-light">
                  Ban driver…
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
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

      {/* Main table */}
      <div className="admin-card">
        <StatusTabs
          value={statusFilter === 'pending_approval' || statusFilter === 'suspended' ? statusFilter : statusFilter ? '_other' : ''}
          onChange={v => { if (v !== '_other') setParams({ status: v || null }) }}
          tabs={[
            { value: '', label: 'All drivers' },
            { value: 'pending_approval', label: 'Pending approval', count: summary.pending_approval, alert: true },
            { value: 'suspended', label: 'Suspended', count: summary.suspended },
            ...(statusFilter && statusFilter !== 'pending_approval' && statusFilter !== 'suspended'
              ? [{ value: '_other', label: statusFilter.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) }] : []),
          ]}
        />
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
            filters={tabOwnsStatus ? [] : [{
              key: 'status', label: 'More statuses',
              options: [
                { value: 'active',        label: 'Active' },
                { value: 'docs_rejected', label: 'Docs Rejected' },
                { value: 'pending_docs',  label: 'Pending Docs' },
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
              columns={(inQueue ? queueColumns : columns) as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
              data={drivers as unknown as Record<string, unknown>[]}
              onRowClick={row => router.push(`/drivers/${(row as unknown as DriverListItem).id}${inQueue ? '?tab=documents' : ''}`)}
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
