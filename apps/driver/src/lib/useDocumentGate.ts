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
        const docs = Object.values({ ...status.photos, ...status.vehicle_docs })
        const rejectedDoc = docs.find(doc => doc.status === 'rejected')
        setHasRejected(!!rejectedDoc)
        // Prefer the specific per-document note over the generic status-
        // transition reason ("Document rejected or expired") — the specific
        // one is already fetched here, no reason to show the vaguer string
        // when it's sitting right next to it.
        setRejectionReason(rejectedDoc?.rejection_note ?? status.rejection_reason)
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
