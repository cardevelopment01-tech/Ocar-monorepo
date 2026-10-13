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
      fetchDocumentGateStatus()
        .then((status) => {
          setHasRejected(status.hasRejected)
          setRejectionReason(status.rejectionReason)
          setIsMissingUpload(status.isMissingUpload)
        })
        .catch(() => {
          // fail open -- server still enforces the block on goOnline()
        })
        .finally(() => setLoading(false))
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
