import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'
import { fetchDocumentGateStatus } from './api'
import type { DocIssue } from './docIssues'

// Mirror of apps/driver/src/lib/useDocumentGate.ts -- same proactive-check /
// server-authoritative split as useWalletGate.ts.
export type DocumentGate = {
  loading: boolean
  hasRejected: boolean
  rejectionReason: string | null
  /** Banner title for the reason, e.g. "Document expired"; null when the server did not say. */
  title: string | null
  /** Every blocking document and why. */
  issues: DocIssue[]
  isMissingUpload: boolean
  canGoOnline: boolean
}

export function useDocumentGate(): DocumentGate {
  const [loading, setLoading] = useState(true)
  const [hasRejected, setHasRejected] = useState(false)
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [issues, setIssues] = useState<DocIssue[]>([])
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
          setTitle(status.title)
          setIssues(status.issues)
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
    title,
    issues,
    isMissingUpload,
    canGoOnline: loading || !hasRejected,
  }
}
