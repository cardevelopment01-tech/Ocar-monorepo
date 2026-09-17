import { useEffect, useState } from 'react'
import { fetchDocumentGateStatus } from './api'

// Mirror of apps/driver/src/lib/useDocumentGate.ts -- same proactive-check /
// server-authoritative split as useWalletGate.ts.
export type DocumentGate = {
  loading: boolean
  hasRejected: boolean
  rejectionReason: string | null
  canGoOnline: boolean
}

export function useDocumentGate(): DocumentGate {
  const [loading, setLoading] = useState(true)
  const [hasRejected, setHasRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)

  useEffect(() => {
    fetchDocumentGateStatus()
      .then((status) => {
        setHasRejected(status.hasRejected)
        setRejectionReason(status.rejectionReason)
      })
      .catch(() => {
        // fail open -- server still enforces the block on goOnline()
      })
      .finally(() => setLoading(false))
  }, [])

  return {
    loading,
    hasRejected,
    rejectionReason,
    canGoOnline: loading || !hasRejected,
  }
}
