import { FileText, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DocIssue } from '@/lib/admin-api'

export function InitialsAvatar({ name, size = 'sm' }: { name: string; size?: 'sm' | 'lg' }) {
  const initials = name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className={cn(
      'rounded-full bg-primary-light flex items-center justify-center flex-shrink-0',
      size === 'lg' ? 'w-16 h-16' : 'w-8 h-8'
    )}>
      <span className={cn('font-bold text-primary', size === 'lg' ? 'text-xl' : 'text-xs')}>{initials}</span>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-10-30' -> '30 Oct 2026', built from the parts so no timezone can move the day. */
export function formatDocDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  const month = MONTHS[Number(m) - 1]
  return y && m && d && month ? `${Number(d)} ${month} ${y}` : iso
}

/** "Insurance expired", "Permit rejected": short enough for a table cell (the full text, with the date, goes in the tooltip). */
export function docIssueBrief(i: DocIssue): string {
  const verb = i.reason === 'expired' ? 'expired' : i.reason === 'rejected' ? 'rejected' : i.reason === 'pending_review' ? 'in review' : 'missing'
  return `${i.label} ${verb}`
}

export function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const DOC_LABELS: Record<string, string> = {
  profile_photo: 'Profile Photo', driving_license: 'Driving Licence',
  driving_license_front: 'Driving Licence (Front)', driving_license_back: 'Driving Licence (Back)',
  aadhaar_front: 'Aadhaar (Front)', aadhaar_back: 'Aadhaar (Back)',
  vehicle_rc_front: 'RC Book (Front)', vehicle_rc_back: 'RC Book (Back)', insurance: 'Insurance Certificate', permit: 'Commercial Permit',
  pollution_cert: 'Pollution Certificate (PUC)', fitness_cert: 'Fitness Certificate',
}
export function docLabel(key: string) {
  return DOC_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export const REQUIRED_DRIVER_DOCS  = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
export const REQUIRED_VEHICLE_DOCS = ['vehicle_rc_front', 'vehicle_rc_back', 'insurance', 'permit']

export function DocCheckItem({
  docType, fileUrl, status, rejectionNote, issue, onClick, uploadedByAdmin,
}: { docType: string; fileUrl: string | null; status: string; rejectionNote?: string | null; issue?: DocIssue | null; onClick: () => void; uploadedByAdmin?: string | null }) {
  const isMissing = !fileUrl || status === 'missing'
  // An approved document past its validity date still has status 'approved'; it blocks the driver, so it must not look fine.
  const isExpired = issue?.reason === 'expired' && status === 'approved'
  const isPdf = fileUrl && /\.pdf(\?|$)/i.test(fileUrl)

  return (
    <button
      onClick={onClick}
      disabled={isMissing}
      className={cn(
        'w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left group',
        isMissing
          ? 'border-dashed border-border bg-surface-2/50 cursor-default'
          : 'border-border bg-surface-2 hover:border-primary/30 hover:bg-primary/3 cursor-pointer'
      )}
    >
      {/* Thumbnail */}
      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-surface-3">
        {isMissing ? (
          <div className="w-full h-full flex items-center justify-center"><FileText size={15} className="text-text-muted" /></div>
        ) : isPdf ? (
          <div className="w-full h-full flex items-center justify-center bg-red-50"><FileText size={15} className="text-red-400" /></div>
        ) : (
          <img src={fileUrl!} alt={docLabel(docType)} className="w-full h-full object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-text-primary truncate">{docLabel(docType)}</p>
        {uploadedByAdmin && !isMissing && (
          <p className="text-[10px] text-text-muted truncate" title={`Uploaded by ${uploadedByAdmin}`}>Uploaded by {uploadedByAdmin}</p>
        )}
        {isExpired
          ? <p className="text-[10px] font-semibold text-danger mt-0.5 truncate">Expired {formatDocDate(issue!.valid_until)}</p>
          : rejectionNote && status === 'rejected'
          ? <p className="text-[10px] text-danger mt-0.5 truncate">{rejectionNote}</p>
          : <p className={cn('text-[10px] mt-0.5 capitalize',
              status === 'approved' ? 'text-success' : status === 'rejected' ? 'text-danger' : status === 'pending' ? 'text-warning' : 'text-text-muted'
            )}>
              {isMissing ? 'Not uploaded' : status}
            </p>
        }
      </div>

      {/* Status icon */}
      {status === 'approved' && !isExpired && <CheckCircle size={15} className="text-success flex-shrink-0" />}
      {isExpired && <AlertCircle size={15} className="text-danger flex-shrink-0" />}
      {status === 'rejected' && <XCircle     size={15} className="text-danger  flex-shrink-0" />}
      {status === 'pending' && fileUrl && <AlertCircle size={15} className="text-warning flex-shrink-0" />}
      {isMissing && <AlertCircle size={15} className="text-text-muted flex-shrink-0" />}

      {!isMissing && (
        <span className="text-[10px] font-semibold text-text-muted opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          View →
        </span>
      )}
    </button>
  )
}
