import { useEffect, useState } from 'react'
import { onboardingApi } from '@/lib/onboarding-api'

interface DocumentGate {
  loading: boolean
  hasRejected: boolean
  rejectionReason: string | null
  canGoOnline: boolean
}

// Same pattern as useWalletGate.ts — proactive client-side pre-check so a
// driver sees a blocked state before tapping "Go Online". Server is
// authoritative: goOnline() re-checks via hasApprovedRequiredDocs() regardless.
export function useDocumentGate(): DocumentGate {
  const [loading, setLoading] = useState(true)
  const [hasRejected, setHasRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)

  useEffect(() => {
    onboardingApi.getDocumentStatus()
      .then(status => {
        const rejected = Object.values({ ...status.photos, ...status.vehicle_docs })
          .some(doc => doc.status === 'rejected')
        setHasRejected(rejected)
        setRejectionReason(status.rejection_reason)
      })
      .catch(() => { /* fail open — server still enforces the block on goOnline() */ })
      .finally(() => setLoading(false))
  }, [])

  return {
    loading,
    hasRejected,
    rejectionReason,
    canGoOnline: loading || !hasRejected,
  }
}
