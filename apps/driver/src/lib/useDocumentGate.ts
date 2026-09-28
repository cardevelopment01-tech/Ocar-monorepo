import { useEffect, useState } from 'react'
import { onboardingApi } from '@/lib/onboarding-api'
import { useAuthStore } from '@/store/useAuthStore'

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
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [loading, setLoading] = useState(true)
  const [hasRejected, setHasRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)

  useEffect(() => {
    // BottomNav (this hook's only caller wired at the app root) mounts on
    // every route including /login, so this must never fire while logged
    // out — a 401 here would otherwise trip api.ts's clearAndRedirect and
    // reload straight back into the same logged-out state, forever.
    if (!isAuthenticated) { setLoading(false); return }
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
  }, [isAuthenticated])

  return {
    loading,
    hasRejected,
    rejectionReason,
    canGoOnline: loading || !hasRejected,
  }
}
