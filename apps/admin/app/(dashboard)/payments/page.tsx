'use client'
import { DEMO_MODE } from '@/lib/demo'
import DemoBlock from '@/components/ui/DemoBlock'
import React from 'react'
import { useState, useEffect, useRef, useCallback } from 'react'
import { IndianRupee } from 'lucide-react'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import { adminPaymentApi, type AdminPaymentItem } from '@/lib/admin-api'
import { cn } from '@/lib/utils'

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function SkeletonRows({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <tr key={i} className="border-b border-border-light last:border-b-0">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-surface-2 rounded animate-pulse" style={{ width: j === 0 ? '100px' : '80px' }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

const CHANNEL_LABELS: Record<string, { label: string; cls: string }> = {
  cash_direct:     { label: 'Cash',   cls: 'pill-muted'   },
  online_upi:      { label: 'UPI',    cls: 'pill-info'    },
  online_card:     { label: 'Card',   cls: 'pill-purple'  },
  platform_wallet: { label: 'Wallet', cls: 'pill-success' },
}

const LIMIT = 20

export default function PaymentsPage() {
  if (DEMO_MODE) return <DemoBlock feature="Payments" />

  const [payments, setPayments] = useState<AdminPaymentItem[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { setDebouncedSearch(search); setPage(1) }, 400)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  const fetchPayments = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, unknown> = { page, limit: LIMIT }
      if (channelFilter) params['channel'] = channelFilter
      if (debouncedSearch) params['search'] = debouncedSearch
      const data = await adminPaymentApi.list(params as Parameters<typeof adminPaymentApi.list>[0])
      setPayments(data.payments)
      setTotal(data.pagination.total)
      setPages(data.pagination.pages)
    } catch {
      setPayments([])
    } finally {
      setLoading(false)
    }
  }, [page, channelFilter, debouncedSearch])

  useEffect(() => { void fetchPayments() }, [fetchPayments])

  const columns = [
    {
      key: 'id', header: 'Payment ID',
      render: (p: AdminPaymentItem) => <span className="font-mono text-xs text-primary">#{p.id}</span>,
    },
    {
      key: 'ride_id', header: 'Ride',
      render: (p: AdminPaymentItem) => <span className="font-mono text-xs text-text-muted">#{p.ride_id}</span>,
    },
    { key: 'user_name',   header: 'User',   render: (p: AdminPaymentItem) => <span className="font-medium text-text-primary">{p.user_name}</span> },
    {
      key: 'driver_name', header: 'Driver',
      render: (p: AdminPaymentItem) => <span className="text-text-secondary">{p.driver_name ?? '—'}</span>,
    },
    {
      key: 'channel', header: 'Channel',
      render: (p: AdminPaymentItem) => {
        const ch = CHANNEL_LABELS[p.channel]
        return <span className={cn('pill', ch?.cls ?? 'pill-muted')}>{ch?.label ?? p.channel}</span>
      },
    },
    {
      key: 'amount', header: 'Amount',
      render: (p: AdminPaymentItem) => <span className="font-bold text-text-primary">₹{parseFloat(p.amount).toLocaleString('en-IN')}</span>,
    },
    {
      key: 'commission_amount', header: 'Commission',
      render: (p: AdminPaymentItem) => <span className="text-text-muted text-xs">₹{parseFloat(p.commission_amount).toLocaleString('en-IN')}</span>,
    },
    {
      key: 'driver_earning', header: 'Driver Gets',
      render: (p: AdminPaymentItem) => <span className="font-semibold text-success">₹{parseFloat(p.driver_earning).toLocaleString('en-IN')}</span>,
    },
    { key: 'status', header: 'Status', render: (p: AdminPaymentItem) => <StatusPill status={p.status} /> },
    {
      key: 'created_at', header: 'Time',
      render: (p: AdminPaymentItem) => <span className="text-text-muted text-xs">{fmt(p.created_at)}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 mb-1">
        <IndianRupee className="w-5 h-5 text-primary" />
        <div>
          <h2 className="text-lg font-bold text-text-primary">Payments</h2>
          <p className="text-xs text-text-muted">{total} total transactions</p>
        </div>
      </div>

      <div className="admin-card">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by user or driver name…"
            filters={[{
              key: 'channel', label: 'All Channels',
              options: [
                { value: 'cash_direct',     label: 'Cash'   },
                { value: 'online_upi',      label: 'UPI'    },
                { value: 'online_card',     label: 'Card'   },
                { value: 'platform_wallet', label: 'Wallet' },
              ],
              value: channelFilter,
              onChange: (v) => { setChannelFilter(v); setPage(1) },
            }]}
            onExport={() => {}}
          />
        </div>
        {loading
          ? <table className="w-full"><tbody><SkeletonRows cols={10} /></tbody></table>
          : (
            <DataTable
              columns={columns as unknown as { key: string; header: string; render?: (row: Record<string, unknown>) => React.ReactNode }[]}
              data={payments as unknown as Record<string, unknown>[]}
              emptyMessage="No payments match your filters"
            />
          )
        }
        {pages > 1 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-light">
            <p className="text-xs text-text-muted">{total} total</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Prev</button>
              <span className="px-3 py-1 text-xs text-text-muted">{page} / {pages}</span>
              <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1 text-xs border border-border rounded-lg disabled:opacity-40 hover:bg-surface-2 transition-colors">Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
