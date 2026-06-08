'use client'
import { useState } from 'react'
import { IndianRupee, TrendingUp, Clock, RotateCcw } from 'lucide-react'
import StatCard from '@/components/ui/StatCard'
import StatusPill from '@/components/ui/StatusPill'
import DataTable from '@/components/ui/DataTable'
import FilterBar from '@/components/ui/FilterBar'
import { mockPayments } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Payment = typeof mockPayments[number]

const CHANNEL_LABELS: Record<string, { label: string; cls: string }> = {
  cash_direct:     { label: 'Cash',   cls: 'pill-muted'    },
  online_upi:      { label: 'UPI',    cls: 'pill-info'     },
  online_card:     { label: 'Card',   cls: 'pill-purple'   },
  platform_wallet: { label: 'Wallet', cls: 'pill-success'  },
}

export default function PaymentsPage() {
  const [search, setSearch] = useState('')
  const [channelFilter, setChannelFilter] = useState('')

  const gross    = mockPayments.reduce((s, p) => s + p.amount, 0)
  const net      = mockPayments.reduce((s, p) => s + p.commission, 0)
  const pending  = mockPayments.filter(p => p.status === 'pending').reduce((s, p) => s + p.driverEarning, 0)

  const filtered = mockPayments.filter(p => {
    if (channelFilter && p.channel !== channelFilter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!p.id.toLowerCase().includes(q) && !p.user.toLowerCase().includes(q) && !p.driver.toLowerCase().includes(q)) return false
    }
    return true
  })

  const columns = [
    { key: 'id', header: 'Payment ID', render: (p: Payment) => <span className="font-mono text-xs text-primary">{p.id}</span> },
    { key: 'rideCode', header: 'Ride', render: (p: Payment) => <span className="font-mono text-xs text-text-muted">{p.rideCode}</span> },
    { key: 'user',   header: 'User',   render: (p: Payment) => <span className="font-medium text-text-primary">{p.user}</span> },
    { key: 'driver', header: 'Driver', render: (p: Payment) => <span className="text-text-secondary">{p.driver}</span> },
    {
      key: 'channel', header: 'Channel',
      render: (p: Payment) => {
        const ch = CHANNEL_LABELS[p.channel]
        return <span className={cn('pill', ch?.cls ?? 'pill-muted')}>{ch?.label ?? p.channel}</span>
      },
    },
    {
      key: 'amount', header: 'Amount',
      render: (p: Payment) => <span className="font-bold text-text-primary">₹{p.amount.toLocaleString('en-IN')}</span>,
    },
    {
      key: 'commission', header: 'Commission',
      render: (p: Payment) => <span className="text-text-muted text-xs">₹{p.commission.toLocaleString('en-IN')}</span>,
    },
    {
      key: 'driverEarning', header: 'Driver Gets',
      render: (p: Payment) => <span className="font-semibold text-success">₹{p.driverEarning.toLocaleString('en-IN')}</span>,
    },
    { key: 'status', header: 'Status', render: (p: Payment) => <StatusPill status={p.status} /> },
    { key: 'time',   header: 'Time',   render: (p: Payment) => <span className="text-text-muted">{p.time}</span> },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="Gross Revenue"       value={`₹${gross.toLocaleString('en-IN')}`} change="+8% today"        changeType="up"      icon={IndianRupee} gradient="blue"   />
        <StatCard title="Net Revenue"         value={`₹${net.toLocaleString('en-IN')}`}   change="Commissions"      changeType="up"      icon={TrendingUp}  gradient="green"  />
        <StatCard title="Pending Settlement"  value={`₹${pending.toLocaleString('en-IN')}`} change="To be paid out" changeType="neutral" icon={Clock}       gradient="amber"  />
        <StatCard title="Refunded"            value="₹0"                                  change="None today"       changeType="neutral" icon={RotateCcw}   gradient="purple" />
      </div>

      <div className="admin-card">
        <div className="mb-4">
          <FilterBar
            search={search}
            onSearch={setSearch}
            searchPlaceholder="Search by payment ID, user or driver…"
            filters={[{
              key: 'channel', label: 'All Channels',
              options: [
                { value: 'cash_direct',    label: 'Cash'   },
                { value: 'online_upi',     label: 'UPI'    },
                { value: 'online_card',    label: 'Card'   },
                { value: 'platform_wallet',label: 'Wallet' },
              ],
              value: channelFilter,
              onChange: setChannelFilter,
            }]}
            onExport={() => {}}
          />
        </div>
        <DataTable
          columns={columns}
          data={filtered as unknown as Record<string, unknown>[]}
          emptyMessage="No payments match your filters"
        />
      </div>
    </div>
  )
}
