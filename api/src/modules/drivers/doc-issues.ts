import type { PoolClient } from 'pg'
import { query } from '@/db/client'
import { REQUIRED_IDENTITY_DOCS, REQUIRED_VEHICLE_DOCS } from './required-docs'

// WHICH documents keep a driver off the road, and WHY. One list feeds the go-online error, the driver app's Documents banner and the
// admin driver profile, so a driver, an admin and the server always say the same thing. Before this, the go-online gate said only
// "a document was rejected" even when the real reason was an expired insurance, and an admin saw those documents as approved (green).
//
// The rules mirror docIssueExistsSql in drivers.repository.ts, which dispatch uses to skip drivers: a document with status 'rejected',
// an 'approved' one whose verified_valid_until has passed, a REQUIRED one still 'pending' review, and an RC front with no RC back.
// tests/integration/doc-issues-vs-gate.test.ts checks the two never disagree.

export type DocIssueReason = 'rejected' | 'expired' | 'pending_review' | 'missing_back'

export type DocIssue = {
  scope: 'identity' | 'vehicle'
  doc_type: string
  /** A readable name for the document ("Insurance"). */
  label: string
  reason: DocIssueReason
  /** The date the document stopped being valid (expired), otherwise null. YYYY-MM-DD. */
  valid_until: string | null
  /** The reviewer's note on a rejected document. */
  note: string | null
  /** A few words, for a banner or a list: "Insurance expired on 30 Oct 2026". */
  short: string
  /** One sentence for the person who has to fix it. */
  message: string
}

export type DocRow = { doc_type: string; status: string; rejection_note: string | null; verified_valid_until: string | null }

const LABELS: Record<string, string> = {
  profile_photo: 'Profile photo',
  driving_license: 'Driving licence',
  driving_license_front: 'Driving licence (front)',
  driving_license_back: 'Driving licence (back)',
  aadhaar_front: 'Aadhaar (front)',
  aadhaar_back: 'Aadhaar (back)',
  id_proof: 'ID proof',
  vehicle_rc_front: 'RC book (front)',
  vehicle_rc_back: 'RC book (back)',
  insurance: 'Insurance',
  permit: 'Permit',
  pollution_cert: 'Pollution certificate (PUC)',
  fitness_cert: 'Fitness certificate',
}

export function docLabel(docType: string): string {
  return LABELS[docType] ?? docType.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-10-30' -> '30 Oct 2026'. Built from the string, so no timezone can shift the day. */
export function formatDocDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  const month = MONTHS[Number(m) - 1]
  return y && m && d && month ? `${Number(d)} ${month} ${y}` : iso
}

function issue(scope: DocIssue['scope'], row: Pick<DocRow, 'doc_type'>, reason: DocIssueReason, extra: { validUntil?: string; note?: string | null } = {}): DocIssue {
  const label = docLabel(row.doc_type)
  const validUntil = extra.validUntil ?? null
  const note = extra.note ?? null
  const short =
    reason === 'expired' ? `${label} expired on ${formatDocDate(validUntil ?? '')}`
    : reason === 'rejected' ? `${label} rejected`
    : reason === 'pending_review' ? `${label} waiting for review`
    : `${label} missing`
  const message =
    reason === 'expired' ? `${label} expired on ${formatDocDate(validUntil ?? '')}. Upload a renewed copy.`
    : reason === 'rejected' ? (note ? `${label} was rejected: ${note}` : `${label} was rejected. Upload it again.`)
    : reason === 'pending_review' ? `${label} is waiting for review.`
    : `${label} is missing. Upload it.`
  return { scope, doc_type: row.doc_type, label, reason, valid_until: validUntil, note, short, message }
}

function classifyRows(scope: DocIssue['scope'], rows: DocRow[], required: readonly string[], today: string): DocIssue[] {
  const out: DocIssue[] = []
  for (const r of rows) {
    if (r.status === 'rejected') out.push(issue(scope, r, 'rejected', { note: r.rejection_note }))
    else if (r.status === 'approved' && r.verified_valid_until !== null && r.verified_valid_until < today) out.push(issue(scope, r, 'expired', { validUntil: r.verified_valid_until }))
    else if (r.status === 'pending' && required.includes(r.doc_type)) out.push(issue(scope, r, 'pending_review'))
  }
  return out
}

/**
 * Pure rule set. `vehicle` is the PRIMARY vehicle's documents, or null when the driver has no primary vehicle.
 * `today` is a YYYY-MM-DD date (the database's CURRENT_DATE, so it matches the SQL gate).
 */
export function classifyDocIssues(input: { identity: DocRow[]; vehicle: DocRow[] | null; today: string }): DocIssue[] {
  const out = classifyRows('identity', input.identity, REQUIRED_IDENTITY_DOCS, input.today)
  if (input.vehicle) {
    out.push(...classifyRows('vehicle', input.vehicle, REQUIRED_VEHICLE_DOCS, input.today))
    const has = (t: string) => input.vehicle!.some((r) => r.doc_type === t)
    if (has('vehicle_rc_front') && !has('vehicle_rc_back')) out.push(issue('vehicle', { doc_type: 'vehicle_rc_back' }, 'missing_back'))
  }
  return out
}

/** The message a driver sees when a document blocks going online: names every document and the reason. */
export function summarizeDocIssues(issues: DocIssue[]): string {
  if (issues.length === 0) return ''
  return `You can't go online yet: ${issues.map((i) => i.short).join('; ')}. Fix this in Documents.`
}

type Runner = <T extends object>(sql: string, params: unknown[]) => Promise<T[]>

export async function findDocIssues(driverId: bigint, client?: PoolClient): Promise<DocIssue[]> {
  const run: Runner = client ? async (sql, params) => (await client.query(sql, params)).rows : query
  const id = driverId.toString()
  const [today, identity, vehicle] = await Promise.all([
    run<{ today: string }>('SELECT CURRENT_DATE::text AS today', []),
    run<DocRow>(
      `SELECT doc_type::text, status::text, rejection_note, verified_valid_until::text
         FROM driver_documents WHERE driver_id = $1 ORDER BY doc_type::text`,
      [id],
    ),
    // LEFT JOIN: a primary vehicle with no documents yet still counts as "has a primary vehicle" (one row, doc_type null).
    run<DocRow & { doc_type: string | null }>(
      `SELECT dvd.doc_type, dvd.status::text AS status, dvd.rejection_note, dvd.verified_valid_until::text AS verified_valid_until
         FROM driver_vehicles dv LEFT JOIN driver_vehicle_documents dvd ON dvd.vehicle_id = dv.id
        WHERE dv.driver_id = $1 AND dv.is_primary = true ORDER BY dvd.doc_type`,
      [id],
    ),
  ])
  const vehicleRows = vehicle.length === 0 ? null : vehicle.filter((r): r is DocRow => r.doc_type !== null)
  return classifyDocIssues({ identity, vehicle: vehicleRows, today: today[0]!.today })
}
