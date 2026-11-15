// What the API says is keeping the driver from going online (GET /drivers/onboarding/documents/status -> doc_issues, and the
// DRIVER_DOCS_REJECTED error's details.issues). The server decides; this only turns the list into a title and a message.

export type DocIssueReason = 'rejected' | 'expired' | 'pending_review' | 'missing_back'

export type DocIssue = {
  scope: 'identity' | 'vehicle'
  doc_type: string
  label: string
  reason: DocIssueReason
  /** YYYY-MM-DD, set when the document has expired. */
  valid_until: string | null
  note: string | null
  /** "Insurance expired on 30 Oct 2026" */
  short: string
  /** One full sentence for the driver. */
  message: string
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-10-30' -> '30 Oct 2026', built from the parts so no timezone can move the day. */
export function formatDocDate(iso: string | null): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  const month = MONTHS[Number(m) - 1]
  return y && m && d && month ? `${Number(d)} ${month} ${y}` : iso
}

/** A banner title and message naming every blocking document and why (one reason -> that reason; mixed -> a general title). */
export function describeDocIssues(issues: DocIssue[]): { title: string; message: string } {
  const many = issues.length > 1
  const reasons = new Set(issues.map((i) => i.reason))
  const only = reasons.size === 1 ? issues[0]!.reason : null
  const title =
    only === 'expired' ? (many ? 'Documents expired' : 'Document expired')
    : only === 'rejected' ? (many ? 'Documents rejected' : 'Document rejected')
    : only === 'pending_review' ? 'Waiting for review'
    : only === 'missing_back' ? 'Action needed'
    : 'Documents need attention'
  return { title, message: issues.map((i) => i.short).join('; ') }
}
