import type { PoolClient } from 'pg'
import { pool } from '@/db/client'
import { config } from '@/config'
import { logger } from '@/lib/logger'
import { getConfigValue } from '@/lib/system-config'
import {
  fyCodeOf, formatInvoiceNo, invoiceDescription, isValidGstin, signInvoiceLink, splitTax, stateCodeOf,
} from './package-invoice'
import { closedPeriods, commissionDescription, parseFrequency, taxFromInclusive, type InvoicePeriod } from './commission-invoice'

const log = logger.child({ module: 'driver-invoice' })

export interface InvoiceParty { name: string; address: string; gstin?: string; state_code: string | null; state_name?: string; phone?: string }
export interface InvoiceLine { ride_id: string | null; date: string; fare: number | null; commission: number }

export interface DriverInvoice {
  id: string
  kind: 'package' | 'commission'
  order_id: string | null
  period_start: string | null
  period_end: string | null
  driver_id: string
  series: string
  invoice_no: string
  fy_code: string
  issued_at: string
  supplier: InvoiceParty
  recipient: InvoiceParty
  place_of_supply_code: string
  sac: string
  description: string
  taxable_value: number
  cgst_rate: number; cgst_amount: number
  sgst_rate: number; sgst_amount: number
  igst_rate: number; igst_amount: number
  total: number
  gateway_payment_id: string | null
  ride_count: number | null
  lines: InvoiceLine[] | null
}
/** Kept so the PDF module and older imports keep working. */
export type PackageInvoice = DriverInvoice

const COLUMNS = `id::text, kind, order_id::text, period_start::text, period_end::text, driver_id::text, series, invoice_no, fy_code, issued_at, supplier,
  recipient, place_of_supply_code, sac, description, taxable_value::float8, cgst_rate::float8, cgst_amount::float8, sgst_rate::float8, sgst_amount::float8,
  igst_rate::float8, igst_amount::float8, total::float8, gateway_payment_id, ride_count, lines`

export type IssueResult = { status: 'issued' | 'exists'; invoiceNo: string } | { status: 'skipped'; reason: string }

// ── Shared: who is selling, who is buying, and the next number ────────────────

interface SupplierContext { supplier: InvoiceParty; supplierCode: string; sac: string }

/** Ocar's registered details from System config. An invoice without the supplier's GSTIN is not a valid tax invoice, so none is issued until it is set. */
async function loadSupplier(sacKey: 'gst_invoice_sac' | 'gst_commission_sac'): Promise<{ ok: true; ctx: SupplierContext } | { ok: false; reason: string }> {
  const [gstin, legalName, address, stateCode, sac] = await Promise.all([
    getConfigValue('gst_supplier_gstin', ''), getConfigValue('gst_supplier_legal_name', ''), getConfigValue('gst_supplier_address', ''),
    getConfigValue('gst_supplier_state_code', '21'), getConfigValue(sacKey, '998319'),
  ])
  if (!isValidGstin(gstin.trim())) return { ok: false, reason: 'supplier_gstin_not_set' }
  if (!legalName.trim() || !address.trim()) return { ok: false, reason: 'supplier_details_not_set' }
  const supplierCode = stateCode.trim()
  return { ok: true, ctx: { supplierCode, sac: sac.trim(), supplier: { name: legalName.trim(), address: address.trim(), gstin: gstin.trim(), state_code: supplierCode } } }
}

interface DriverRow {
  full_name: string | null; residential_address: string | null; state: string | null; city: string | null; pincode: string | null
  phone: string | null; city_state: string | null
}

/**
 * Place of supply for a service sold to someone not registered for GST is the recipient's address on record; with none on record it is the
 * supplier's location. The driver's state comes from their profile, else from their operating city.
 */
function recipientOf(d: DriverRow, supplierCode: string): { recipient: InvoiceParty; placeOfSupply: string; intraState: boolean } {
  const stateName = (d.state ?? '').trim() || (d.city_state ?? '').trim()
  const code = stateCodeOf(d.state) ?? stateCodeOf(d.city_state)
  const addressLine = [d.residential_address, d.city, d.state, d.pincode].map((p) => (p ?? '').trim()).filter(Boolean).join(', ')
  const placeOfSupply = code ?? supplierCode
  return {
    placeOfSupply, intraState: placeOfSupply === supplierCode,
    recipient: { name: (d.full_name ?? '').trim() || 'Driver', address: addressLine, state_code: code, ...(stateName ? { state_name: stateName } : {}), ...(d.phone ? { phone: d.phone } : {}) },
  }
}

const DRIVER_SQL = `d.full_name, d.residential_address, d.state, d.city, d.pincode, d.phone, c.state AS city_state`

/** The next number in a series for the financial year, taken on the caller's transaction so a rollback gives it back (the series has no gaps). */
async function nextNumber(client: PoolClient, series: 'PK' | 'CM', at: Date): Promise<{ fy: string; seq: number; invoiceNo: string }> {
  const fy = fyCodeOf(at)
  const counter = await client.query<{ last_seq: number }>(
    `INSERT INTO invoice_counters (series, fy_code, last_seq) VALUES ($1, $2, 1)
     ON CONFLICT (series, fy_code) DO UPDATE SET last_seq = invoice_counters.last_seq + 1
     RETURNING last_seq`,
    [series, fy]
  )
  const seq = counter.rows[0]!.last_seq
  return { fy, seq, invoiceNo: formatInvoiceNo(fy, seq, series) }
}

// ── Package purchase invoices ────────────────────────────────────────────────

/**
 * Issues the tax invoice for a completed ride-credit purchase. Safe to call any number of times for the same order: the first call issues,
 * the rest find it. The number comes from a per-financial-year counter taken in the same transaction as the invoice row, so a failed or
 * duplicate attempt rolls the counter back and the series never has a gap.
 *
 * Skipped (not an error) when there is nothing taxable recorded on the order (bought before GST was added) or when Ocar's GSTIN is not set.
 */
export async function issuePackageInvoice(orderId: string): Promise<IssueResult> {
  const ord = await pool.query<DriverRow & {
    id: string; driver_id: string; status: string; price_amount: string | null; gst_percent: string; gst_amount: string
    threshold_value: string; validity_days: number; gateway_payment_id: string | null
  }>(
    `SELECT o.id::text, o.driver_id::text, o.status, o.price_amount, o.gst_percent, o.gst_amount, o.threshold_value, o.validity_days,
            COALESCE(o.gateway_payment_id, o.razorpay_payment_id) AS gateway_payment_id, ${DRIVER_SQL}
       FROM package_purchase_orders o
       JOIN drivers d ON d.id = o.driver_id
       LEFT JOIN cities c ON c.id = d.city_id
      WHERE o.id = $1`,
    [orderId]
  )
  const o = ord.rows[0]
  if (!o) return { status: 'skipped', reason: 'order_not_found' }
  if (o.status !== 'completed') return { status: 'skipped', reason: 'order_not_paid' }
  const taxable = o.price_amount === null ? 0 : parseFloat(o.price_amount)
  const gst = parseFloat(o.gst_amount)
  if (taxable <= 0 || gst <= 0) return { status: 'skipped', reason: 'no_taxable_amount' }

  const existing = await pool.query<{ invoice_no: string }>('SELECT invoice_no FROM driver_invoices WHERE order_id = $1', [orderId])
  if (existing.rows[0]) return { status: 'exists', invoiceNo: existing.rows[0].invoice_no }

  const sup = await loadSupplier('gst_invoice_sac')
  if (!sup.ok) return { status: 'skipped', reason: sup.reason }
  const { recipient, placeOfSupply, intraState } = recipientOf(o, sup.ctx.supplierCode)
  const tax = splitTax(taxable, gst, parseFloat(o.gst_percent), intraState)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const n = await nextNumber(client, 'PK', new Date())
    const ins = await client.query(
      `INSERT INTO driver_invoices (kind, order_id, driver_id, series, invoice_no, fy_code, seq, supplier, recipient, place_of_supply_code, sac, description,
         taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total, gateway_payment_id)
       VALUES ('package',$1,$2,'PK',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (order_id) WHERE order_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        orderId, o.driver_id, n.invoiceNo, n.fy, n.seq, JSON.stringify(sup.ctx.supplier), JSON.stringify(recipient), placeOfSupply, sup.ctx.sac,
        invoiceDescription(parseFloat(o.threshold_value), o.validity_days), taxable, tax.cgstRate, tax.cgst, tax.sgstRate, tax.sgst,
        tax.igstRate, tax.igstAmount, tax.total, o.gateway_payment_id,
      ]
    )
    if ((ins.rowCount ?? 0) === 0) {
      // Another call issued it between the check and the insert: give the number back so the series stays gap-free.
      await client.query('ROLLBACK')
      const again = await pool.query<{ invoice_no: string }>('SELECT invoice_no FROM driver_invoices WHERE order_id = $1', [orderId])
      return { status: 'exists', invoiceNo: again.rows[0]?.invoice_no ?? n.invoiceNo }
    }
    await client.query('COMMIT')
    return { status: 'issued', invoiceNo: n.invoiceNo }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

/** Issuing is never allowed to break a purchase that has already been paid and credited: a failure is logged and retried on the next call. */
export async function issuePackageInvoiceSafely(orderId: string): Promise<void> {
  try {
    const r = await issuePackageInvoice(orderId)
    if (r.status === 'skipped' && r.reason !== 'no_taxable_amount') log.warn({ orderId, reason: r.reason }, 'package invoice not issued')
  } catch (err) {
    log.error({ err, orderId }, 'package invoice failed — will be retried when the driver next opens their invoices')
  }
}

/** Orders that were paid and credited but have no invoice yet (issuing failed, or the GSTIN was not set at the time). Oldest first. */
async function issueMissingFor(driverId: bigint): Promise<void> {
  const missing = await pool.query<{ id: string }>(
    `SELECT o.id::text FROM package_purchase_orders o
      WHERE o.driver_id = $1 AND o.status = 'completed' AND o.price_amount IS NOT NULL AND o.gst_amount > 0
        AND NOT EXISTS (SELECT 1 FROM driver_invoices i WHERE i.order_id = o.id)
      ORDER BY o.completed_at LIMIT 20`,
    [driverId]
  )
  for (const row of missing.rows) await issuePackageInvoiceSafely(row.id)
}

// ── Commission invoices (consolidated per driver per period) ─────────────────

interface CommissionRun { periods: number; issued: number; skipped?: string }

/**
 * Issues the consolidated commission invoices for every driver who had commission deducted in a period that has ended. Runs daily and looks
 * back over the last few closed periods, so a missed day, an outage or the first deploy heals itself; a driver who already has the invoice for
 * a period is never invoiced for it twice. The amount cut from the wallet already includes the GST, so the invoice backs the tax out of the
 * period total (never adds it on top) and lists the rides as an annexure.
 */
export async function issueCommissionInvoices(now: Date = new Date()): Promise<CommissionRun> {
  const sup = await loadSupplier('gst_commission_sac')
  if (!sup.ok) { log.warn({ reason: sup.reason }, 'commission invoices not issued'); return { periods: 0, issued: 0, skipped: sup.reason } }
  const gstPercent = parseFloat(await getConfigValue('commission_gst_percent', '18'))
  if (!Number.isFinite(gstPercent) || gstPercent <= 0) { log.warn({ gstPercent }, 'commission invoices not issued: no GST rate set'); return { periods: 0, issued: 0, skipped: 'commission_gst_percent_not_set' } }
  const frequency = parseFrequency(await getConfigValue('commission_invoice_period', 'monthly'))

  const periods = closedPeriods(now, frequency, 3)
  let issued = 0
  for (const p of periods) {
    // Rides that settled in this period but whose commission was later given back would need a credit note; nothing in the system reverses a
    // commission today, so seeing one means a manual adjustment tied to a ride and it should be looked at.
    const reversed = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM driver_wallet_ledger WHERE entry_type = 'refund_credit' AND ride_id IS NOT NULL AND created_at >= $1 AND created_at < $2`,
      [p.start.toISOString(), p.end.toISOString()]
    )
    if ((reversed.rows[0]?.n ?? 0) > 0) log.warn({ period: p.label, count: reversed.rows[0]!.n }, 'refund credits tied to rides in an invoiced period: a credit note may be needed')

    const due = await pool.query<{ driver_id: string }>(
      `SELECT l.driver_id::text FROM driver_wallet_ledger l
        WHERE l.entry_type = 'commission_debit' AND l.status = 'completed' AND l.created_at >= $1 AND l.created_at < $2
          AND NOT EXISTS (SELECT 1 FROM driver_invoices i WHERE i.driver_id = l.driver_id AND i.kind = 'commission' AND i.period_start = $3::date)
        GROUP BY l.driver_id HAVING SUM(l.amount) > 0
        ORDER BY l.driver_id`,
      [p.start.toISOString(), p.end.toISOString(), p.startDate]
    )
    for (const row of due.rows) {
      try {
        if ((await issueCommissionInvoiceFor(row.driver_id, p, sup.ctx, gstPercent)) === 'issued') issued++
      } catch (err) {
        log.error({ err, driverId: row.driver_id, period: p.label }, 'commission invoice failed — retried on the next daily run')
      }
    }
  }
  if (issued > 0) log.info({ issued, frequency }, 'commission invoices issued')
  return { periods: periods.length, issued }
}

async function issueCommissionInvoiceFor(driverId: string, p: InvoicePeriod, sup: SupplierContext, gstPercent: number): Promise<'issued' | 'exists'> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const drv = await client.query<DriverRow>(
      `SELECT ${DRIVER_SQL} FROM drivers d LEFT JOIN cities c ON c.id = d.city_id WHERE d.id = $1`, [driverId]
    )
    const lineRows = await client.query<{ ride_id: string | null; created_at: Date; commission: number; fare: number | null }>(
      `SELECT l.ride_id::text, l.created_at, l.amount::float8 AS commission, p.amount::float8 AS fare
         FROM driver_wallet_ledger l LEFT JOIN payments p ON p.ride_id = l.ride_id
        WHERE l.driver_id = $1 AND l.entry_type = 'commission_debit' AND l.status = 'completed' AND l.created_at >= $2 AND l.created_at < $3
        ORDER BY l.created_at, l.id`,
      [driverId, p.start.toISOString(), p.end.toISOString()]
    )
    if (!drv.rows[0] || lineRows.rows.length === 0) { await client.query('ROLLBACK'); return 'exists' }

    const grossPaise = lineRows.rows.reduce((s, r) => s + Math.round(r.commission * 100), 0)
    if (grossPaise <= 0) { await client.query('ROLLBACK'); return 'exists' }
    const gross = grossPaise / 100
    const { taxable, gst } = taxFromInclusive(gross, gstPercent)
    if (taxable <= 0) { await client.query('ROLLBACK'); return 'exists' }
    const { recipient, placeOfSupply, intraState } = recipientOf(drv.rows[0], sup.supplierCode)
    const tax = splitTax(taxable, gst, gstPercent, intraState)
    const lines: InvoiceLine[] = lineRows.rows.map((r) => ({
      ride_id: r.ride_id, date: new Date(r.created_at).toISOString(), fare: r.fare, commission: r.commission,
    }))

    const n = await nextNumber(client, 'CM', new Date())
    const ins = await client.query(
      `INSERT INTO driver_invoices (kind, period_start, period_end, driver_id, series, invoice_no, fy_code, seq, supplier, recipient, place_of_supply_code, sac,
         description, taxable_value, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total, ride_count, lines)
       VALUES ('commission',$1,$2,$3,'CM',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (driver_id, period_start) WHERE kind = 'commission' DO NOTHING
       RETURNING id`,
      [
        p.startDate, p.endDate, driverId, n.invoiceNo, n.fy, n.seq, JSON.stringify(sup.supplier), JSON.stringify(recipient), placeOfSupply, sup.sac,
        commissionDescription(p, lines.length), taxable, tax.cgstRate, tax.cgst, tax.sgstRate, tax.sgst, tax.igstRate, tax.igstAmount, tax.total,
        lines.length, JSON.stringify(lines),
      ]
    )
    if ((ins.rowCount ?? 0) === 0) { await client.query('ROLLBACK'); return 'exists' } // another run got there first; its number is not ours to burn
    await client.query('COMMIT')
    return 'issued'
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

// ── Reading ──────────────────────────────────────────────────────────────────

export type InvoiceListRow = Pick<DriverInvoice, 'id' | 'kind' | 'invoice_no' | 'issued_at' | 'description' | 'taxable_value' | 'total' | 'period_start' | 'period_end' | 'ride_count'> & { gst_total: number }

export async function listInvoicesForDriver(driverId: bigint): Promise<InvoiceListRow[]> {
  await issueMissingFor(driverId)
  const res = await pool.query(
    `SELECT id::text, kind, invoice_no, issued_at, description, taxable_value::float8, total::float8, period_start::text, period_end::text, ride_count,
            (cgst_amount + sgst_amount + igst_amount)::float8 AS gst_total
       FROM driver_invoices WHERE driver_id = $1 ORDER BY issued_at DESC, id DESC LIMIT 100`,
    [driverId]
  )
  return res.rows
}

export async function getInvoiceForDriver(id: string, driverId: bigint): Promise<DriverInvoice | null> {
  const res = await pool.query<DriverInvoice>(`SELECT ${COLUMNS} FROM driver_invoices WHERE id = $1 AND driver_id = $2`, [id, driverId])
  return res.rows[0] ?? null
}

export async function getInvoiceById(id: string): Promise<DriverInvoice | null> {
  const res = await pool.query<DriverInvoice>(`SELECT ${COLUMNS} FROM driver_invoices WHERE id = $1`, [id])
  return res.rows[0] ?? null
}

const LINK_TTL_SECONDS = 300

/** A link the app opens in a browser tab to show or save the invoice PDF; good for five minutes. */
export function invoiceDownloadUrl(invoiceId: string, driverId: bigint): string {
  const token = signInvoiceLink(invoiceId, driverId.toString(), Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS, config.JWT_ACCESS_SECRET)
  return `${config.API_BASE_URL}/api/v1/payments/packages/invoices/${invoiceId}/pdf?t=${encodeURIComponent(token)}`
}

/** Every invoice issued in [from, to), oldest first: what the CA needs for the GSTR-1 return. */
export async function listInvoicesBetween(from: Date, to: Date): Promise<DriverInvoice[]> {
  const res = await pool.query<DriverInvoice>(
    `SELECT ${COLUMNS} FROM driver_invoices WHERE issued_at >= $1 AND issued_at < $2 ORDER BY series, fy_code, seq`,
    [from.toISOString(), to.toISOString()]
  )
  return res.rows
}
