import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { useAuthStore } from '@/store/useAuthStore'

export default function PendingReview() {
  const navigate = useNavigate()
  const driver = useAuthStore(s => s.driver)

  useEffect(() => {
    if (driver?.status === 'active') {
      navigate('/', { replace: true })
    }
  }, [driver?.status, navigate])

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
        <div className="bg-surface-2 border border-border rounded-2xl px-6 py-4 w-full max-w-xs">
          <p className="text-text-muted text-xs font-semibold uppercase tracking-wider mb-1">Your Driver Code</p>
          <p className="text-primary font-mono text-2xl font-bold tracking-widest">{driver.code}</p>
          <p className="text-text-muted text-xs mt-1">Keep this for support enquiries</p>
        </div>
      )}
    </div>
  )
}
