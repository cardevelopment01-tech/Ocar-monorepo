import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, RefreshCw, XCircle, AlertTriangle, FileX } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'
import { onboardingApi, type DocumentStatus } from '@/lib/onboarding-api'
import api from '@/lib/api'
import type { DriverProfile } from '@/store/useAuthStore'

const DOC_LABELS: Record<string, string> = {
  profile_photo: 'Profile Photo', driving_license: 'Driving Licence',
  aadhaar_front: 'Aadhaar (Front)', aadhaar_back: 'Aadhaar (Back)',
  driving_license_front: 'Driving Licence (Front)', driving_license_back: 'Driving Licence (Back)',
  vehicle_rc: 'RC Book', insurance: 'Insurance Certificate', permit: 'Commercial Permit',
  pollution_cert: 'Pollution Certificate (PUC)', fitness_cert: 'Fitness Certificate',
}

export default function PendingReview() {
  const navigate = useNavigate()
  const driver = useAuthStore(s => s.driver)
  const updateDriver = useAuthStore(s => s.updateDriver)
  const [checking, setChecking] = useState(false)
  const [docStatus, setDocStatus] = useState<DocumentStatus | null>(null)

  useEffect(() => {
    if (driver?.status === 'active') navigate('/', { replace: true })
  }, [driver?.status, navigate])

  useEffect(() => {
    if (driver?.status === 'docs_rejected') {
      onboardingApi.getDocumentStatus().then(setDocStatus).catch(() => {})
    }
  }, [driver?.status])

  useEffect(() => {
    const id = setInterval(() => { void checkStatus() }, 30_000)
    return () => clearInterval(id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const checkStatus = async () => {
    setChecking(true)
    try {
      const res = await api.get<{ driver: DriverProfile }>('/api/v1/drivers/me')
      const fresh = res.data.driver
      updateDriver({ status: fresh.status, onboarding_step: fresh.onboarding_step })
    } catch {
      // ignore
    } finally {
      setChecking(false)
    }
  }

  if (driver?.status === 'docs_rejected') {
    const rejectedDocs = [
      ...Object.entries(docStatus?.photos ?? {}).filter(([, v]) => v.status === 'rejected'),
      ...Object.entries(docStatus?.vehicle_docs ?? {}).filter(([, v]) => v.status === 'rejected'),
    ]

    return (
      <div className="min-h-screen bg-bg text-text-primary flex flex-col items-center justify-center px-8 text-center">
        <div className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center mb-6">
          <FileX size={36} className="text-amber-500" />
        </div>
        <h1 className="text-2xl font-bold mb-3">Documents Need Fixing</h1>

        {docStatus?.rejection_reason ? (
          <p className="text-text-secondary text-sm leading-relaxed mb-6 max-w-xs">
            {docStatus.rejection_reason}
          </p>
        ) : (
          <p className="text-text-secondary text-sm leading-relaxed mb-6 max-w-xs">
            Some of your documents were rejected. Please fix them and resubmit your application.
          </p>
        )}

        {rejectedDocs.length > 0 && (
          <div className="bg-surface-2 border border-border rounded-2xl px-5 py-4 w-full max-w-xs mb-6 text-left space-y-2">
            <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-2">Rejected Documents</p>
            {rejectedDocs.map(([key, v]) => (
              <div key={key} className="flex flex-col gap-0.5">
                <p className="text-sm font-semibold text-amber-400">{DOC_LABELS[key] ?? key}</p>
                {v.rejection_note && (
                  <p className="text-xs text-text-muted leading-snug">{v.rejection_note}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={() => navigate('/onboarding/documents', { replace: true })}
          className="btn-go w-full max-w-xs mb-4"
          style={{ minHeight: 52 }}
        >
          Fix Documents
        </button>

        {driver.code && (
          <div className="bg-surface-2 border border-border rounded-2xl px-6 py-3 w-full max-w-xs">
            <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1">Your Driver Code</p>
            <p className="text-text-secondary font-mono text-xl font-bold tracking-widest">{driver.code}</p>
          </div>
        )}
      </div>
    )
  }

  if (driver?.status === 'suspended') {
    return (
      <div className="min-h-screen bg-bg text-text-primary flex flex-col items-center justify-center px-8 text-center">
        <div className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center mb-6">
          <AlertTriangle size={36} className="text-amber-500" />
        </div>
        <h1 className="text-2xl font-bold mb-3">Account Suspended</h1>
        <p className="text-text-secondary text-sm leading-relaxed mb-8">
          Your driver account has been temporarily suspended. Please contact our support team for more information.
        </p>
        {driver.code && (
          <div className="bg-surface-2 border border-border rounded-2xl px-6 py-4 w-full max-w-xs mb-6">
            <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1">Your Driver Code</p>
            <p className="text-primary font-mono text-2xl font-bold tracking-widest">{driver.code}</p>
            <p className="text-text-muted text-xs mt-1">Provide this when contacting support</p>
          </div>
        )}
        <button
          onClick={() => void checkStatus()}
          disabled={checking}
          className="flex items-center gap-2 text-sm font-semibold text-primary disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
          {checking ? 'Checking…' : 'Check status'}
        </button>
      </div>
    )
  }

  if (driver?.status === 'banned') {
    return (
      <div className="min-h-screen bg-bg text-text-primary flex flex-col items-center justify-center px-8 text-center">
        <div className="w-20 h-20 rounded-full bg-accent-red/10 flex items-center justify-center mb-6">
          <XCircle size={36} className="text-accent-red" />
        </div>
        <h1 className="text-2xl font-bold mb-3">Account Banned</h1>
        <p className="text-text-secondary text-sm leading-relaxed mb-8">
          Your driver account has been permanently deactivated due to a violation of our terms. You are no longer eligible to drive on Ocar.
        </p>
        {driver.code && (
          <div className="bg-surface-2 border border-border rounded-2xl px-6 py-4 w-full max-w-xs">
            <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1">Your Driver Code</p>
            <p className="text-text-secondary font-mono text-2xl font-bold tracking-widest">{driver.code}</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg text-text-primary flex flex-col items-center justify-center px-8 text-center">
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mb-6">
        <Clock size={36} className="text-primary" />
      </div>

      <h1 className="text-2xl font-bold mb-3">Application Submitted</h1>
      <p className="text-text-secondary text-sm leading-relaxed mb-8">
        Our team is reviewing your documents. This typically takes 1–2 business days. You'll receive an SMS once your account is approved.
      </p>

      {driver?.code && (
        <div className="bg-surface-2 border border-border rounded-2xl px-6 py-4 w-full max-w-xs mb-6">
          <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1">Your Driver Code</p>
          <p className="text-primary font-mono text-2xl font-bold tracking-widest">{driver.code}</p>
          <p className="text-text-muted text-xs mt-1">Keep this for support enquiries</p>
        </div>
      )}

      <button
        onClick={() => void checkStatus()}
        disabled={checking}
        className="flex items-center gap-2 text-sm font-semibold text-primary disabled:opacity-50 cursor-pointer"
      >
        <RefreshCw size={15} className={checking ? 'animate-spin' : ''} />
        {checking ? 'Checking…' : 'Check approval status'}
      </button>
    </div>
  )
}
