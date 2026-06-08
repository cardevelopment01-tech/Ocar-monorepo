import { cn } from '@/lib/utils'

const STATUS_MAP: Record<string, string> = {
  active: 'pill-success', completed: 'pill-success', online: 'pill-success',
  pending: 'pill-warning', pending_approval: 'pill-warning', requested: 'pill-warning',
  pending_docs: 'pill-muted', draft: 'pill-muted',
  cancelled: 'pill-danger', suspended: 'pill-danger', failed: 'pill-danger', banned: 'pill-danger',
  in_progress: 'pill-info', accepted: 'pill-info',
  disputed: 'pill-purple',
  one_way: 'pill-info', round_trip: 'pill-purple', rental: 'pill-muted',
  under_review: 'pill-warning', resolved: 'pill-success',
  open: 'pill-warning',
  cash_direct: 'pill-muted', online_upi: 'pill-info', online_card: 'pill-purple', platform_wallet: 'pill-success',
}

const LABELS: Record<string, string> = {
  pending_approval: 'Pending Approval',
  pending_docs: 'Pending Docs',
  in_progress: 'In Progress',
  one_way: 'One Way',
  round_trip: 'Round Trip',
  under_review: 'Under Review',
  cash_direct: 'Cash',
  online_upi: 'UPI',
  online_card: 'Card',
  platform_wallet: 'Wallet',
}

interface StatusPillProps {
  status: string
  className?: string
}

export default function StatusPill({ status, className }: StatusPillProps) {
  const cls = STATUS_MAP[status] ?? 'pill-muted'
  const label = LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1)
  return <span className={cn(cls, className)}>{label}</span>
}
