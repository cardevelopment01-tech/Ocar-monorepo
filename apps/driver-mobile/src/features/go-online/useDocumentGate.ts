import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { fetchDocumentGateStatus } from './api'

// Mirror of apps/driver/src/lib/useDocumentGate.ts -- same proactive-check /
// server-authoritative split as useWalletGate.ts.
export type DocumentGate = {
  loading: boolean
  hasRejected: boolean
  rejectionReason: string | null
  isMissingUpload: boolean
  canGoOnline: boolean
}

export function useDocumentGate(): DocumentGate {
  const [loading, setLoading] = useState(true)
  const [hasRejected, setHasRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [isMissingUpload, setIsMissingUpload] = useState(false)

  // Refetch on every focus so a fix made on the Documents screen clears the banner on return.
  useFocusEffect(
    useCallback(() => {
      // A later focus can start a second fetch; drop the earlier one's result if it lands late.
      let stale = false
      fetchDocumentGateStatus()
        .then((status) => {
          if (stale) return
          setHasRejected(status.hasRejected)
          setRejectionReason(status.rejectionReason)
          setIsMissingUpload(status.isMissingUpload)
        })
        .catch(() => {
          // fail open -- server still enforces the block on goOnline()
        })
        .finally(() => { if (!stale) setLoading(false) })
      return () => { stale = true }
    }, [])
  )

  return {
    loading,
    hasRejected,
    rejectionReason,
    isMissingUpload,
    canGoOnline: loading || !hasRejected,
  }
}
