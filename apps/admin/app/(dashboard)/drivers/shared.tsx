import { FileText, CheckCircle, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

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

export function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const DOC_LABELS: Record<string, string> = {
  profile_photo: 'Profile Photo', driving_license: 'Driving Licence',
  driving_license_front: 'Driving Licence (Front)', driving_license_back: 'Driving Licence (Back)',
  aadhaar_front: 'Aadhaar (Front)', aadhaar_back: 'Aadhaar (Back)',
  vehicle_rc: 'RC Book', insurance: 'Insurance Certificate', permit: 'Commercial Permit',
  pollution_cert: 'Pollution Certificate (PUC)', fitness_cert: 'Fitness Certificate',
}
export function docLabel(key: string) {
  return DOC_LABELS[key] ?? key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export const REQUIRED_DRIVER_DOCS  = ['profile_photo', 'driving_license_front', 'driving_license_back', 'aadhaar_front', 'aadhaar_back']
export const REQUIRED_VEHICLE_DOCS = ['vehicle_rc', 'insurance', 'permit']

export function DocCheckItem({
  docType, fileUrl, status, rejectionNote, onClick,
}: { docType: string; fileUrl: string | null; status: string; rejectionNote?: string | null; onClick: () => void }) {
  const isMissing = !fileUrl || status === 'missing'
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
          <img src={fileUrl!} alt={docLabel(docType)} className="w-full h-full object-cover" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-text-primary truncate">{docLabel(docType)}</p>
        {rejectionNote && status === 'rejected'
          ? <p className="text-[10px] text-danger mt-0.5 truncate">{rejectionNote}</p>
          : <p className={cn('text-[10px] mt-0.5 capitalize',
              status === 'approved' ? 'text-success' : status === 'rejected' ? 'text-danger' : status === 'pending' ? 'text-warning' : 'text-text-muted'
            )}>
              {isMissing ? 'Not uploaded' : status}
            </p>
        }
      </div>

      {/* Status icon */}
      {status === 'approved' && <CheckCircle size={15} className="text-success flex-shrink-0" />}
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
