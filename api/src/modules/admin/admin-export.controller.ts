import type { Request, Response, NextFunction } from 'express'
import { httpError } from '@/lib/errors'
import { collectRows, exportDate, exportPhone, exportMoney, sendCsvExport, EXPORT_MAX_ROWS, type CsvColumn } from '@/lib/csv-export'
import * as repo from './admin.repository'
import { getSosAlerts, getDisputes } from '@/modules/safety/safety.repository'
import { listSettlementBatches, getSettlementBatchDetail } from '@/modules/payments/submodules/settlements/settlements.service'

// CSV exports for the admin lists other than Drivers (that one lives in admin.controller). Each export reuses the list's own
// repository query, so filters mean the same thing in the file as on screen. Roles and throttling are set in admin.routes.

type Row = Record<string, unknown>
const str = (req: Request, k: string): string | undefined => {
  const v = req.query[k]
  return typeof v === 'string' && v ? v : undefined
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
// Date.parse accepts 2026-02-31 (rolls over to March), so round-trip the day to be sure it is a real one.
const isDay = (d: string) => { const t = Date.parse(d); return DAY_RE.test(d) && !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d }
const SOS_STATUSES = new Set(['active', 'triggered', 'acknowledged', 'responding', 'resolved', 'false_alarm'])
const DISPUTE_STATUSES = new Set(['open', 'under_review', 'pending_info', 'escalated', 'resolved', 'withdrawn'])
// Lists that come back whole (no paging): one extra row is enough for sendCsvExport to see the cap was passed.
const capped = (rows: Row[]): Row[] => rows.slice(0, EXPORT_MAX_ROWS + 1)

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next) }
}
const col = (header: string, key: string, fmt?: (v: unknown) => unknown): CsvColumn<Row> =>
  ({ header, value: r => (fmt ? fmt(r[key]) : r[key]) })
const date = (v: unknown) => exportDate(v)
const money = exportMoney
const phone = (v: unknown) => exportPhone(v)
const day = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10)

export const exportUsers = wrap(async (req, res) => {
  const f: { status?: string; search?: string } = {}
  const status = str(req, 'status'); if (status) f.status = status
  const search = str(req, 'search'); if (search) f.search = search
  const rows = await collectRows<Row>(async (limit, offset) => (await repo.listAdminUsers({ ...f, limit, offset })).rows as Row[])
  await sendCsvExport(req, res, {
    entity: 'users', targetTable: 'users', filters: f, rows,
    columns: [
      col('User code', 'code'), col('Name', 'name'), col('Phone', 'phone', phone), col('Email', 'email'), col('Status', 'status'),
      col('Completed rides', 'total_rides'), col('Wallet balance (INR)', 'wallet_balance', money), col('Rating', 'rating_avg'),
      col('Signed up (UTC)', 'created_at', date),
    ],
  })
})

export const exportRides = wrap(async (req, res) => {
  const from = str(req, 'dateFrom'); const to = str(req, 'dateTo')
  // Rides are the biggest table: without a window an export would only ever hit the cap, so ask for one.
  if (!from || !to || !isDay(from) || !isDay(to)) {
    throw httpError(400, 'Choose a date range (dateFrom and dateTo) to export rides.', 'DATE_RANGE_REQUIRED')
  }
  const f: { status?: string; ride_type?: string; search?: string; cash_discrepancy?: boolean; date_from: string; date_to: string; city_id?: number; attention?: boolean } =
    { date_from: from, date_to: to }
  const status = str(req, 'status'); if (status) f.status = status
  const type = str(req, 'ride_type'); if (type) f.ride_type = type
  const search = str(req, 'search'); if (search) f.search = search
  const cash = str(req, 'cashDiscrepancy'); if (cash) f.cash_discrepancy = cash === 'true'
  const city = str(req, 'cityId'); if (city && /^\d{1,9}$/.test(city)) f.city_id = parseInt(city, 10)
  if (str(req, 'attention') === 'true') f.attention = true
  const rows = await collectRows<Row>(async (limit, offset) => (await repo.listAdminRides({ ...f, limit, offset })).rows as Row[])
  await sendCsvExport(req, res, {
    entity: 'rides', targetTable: 'rides', filters: f, rows,
    columns: [
      col('Ride ID', 'id'), col('Status', 'status'), col('Type', 'ride_type'), col('Trip mode', 'trip_mode'),
      col('Rider', 'user_name'), col('Rider phone', 'user_phone', phone), col('Driver', 'driver_name'), col('Driver phone', 'driver_phone', phone),
      col('Pickup', 'origin_address'), col('Drop', 'destination_address'),
      col('Requested (UTC)', 'requested_at', date), col('Started (UTC)', 'started_at', date), col('Completed (UTC)', 'completed_at', date),
      col('Fare (INR)', 'fare', money), col('Payment status', 'payment_status'), col('Payment channel', 'payment_channel'),
      col('Commission (INR)', 'commission_amount', money), col('Driver earning (INR)', 'driver_earning', money),
      col('Cash collected (INR)', 'cash_collected_amount', money), col('Cash discrepancy', 'cash_discrepancy'),
      col('Cancelled by', 'cancellation_actor'), col('Cancel reason', 'cancellation_reason_code'),
    ],
  })
})

export const exportPayments = wrap(async (req, res) => {
  const f: { channel?: string; search?: string } = {}
  const channel = str(req, 'channel'); if (channel) f.channel = channel
  const search = str(req, 'search'); if (search) f.search = search
  const rows = await collectRows<Row>(async (limit, offset) => (await repo.listAdminPayments({ ...f, limit, offset })).rows as Row[])
  await sendCsvExport(req, res, {
    entity: 'payments', targetTable: 'payments', filters: f, rows,
    columns: [
      col('Payment ID', 'id'), col('Ride ID', 'ride_id'), col('Status', 'status'), col('Channel', 'channel'),
      col('Amount (INR)', 'amount', money), col('Discount (INR)', 'discount_amount', money), col('Commission (INR)', 'commission_amount', money),
      col('Driver earning (INR)', 'driver_earning', money), col('Rider', 'user_name'), col('Driver', 'driver_name'),
      col('Created (UTC)', 'created_at', date),
    ],
  })
})

export const exportFleet = wrap(async (req, res) => {
  const status = str(req, 'status')
  const rows = capped((await repo.listFleet(status)) as unknown as Row[])
  await sendCsvExport(req, res, {
    entity: 'fleet', targetTable: 'driver_vehicles', filters: status ? { status } : {}, rows,
    columns: [
      col('Plate', 'number_plate'), col('Vehicle', 'vehicle_name'), col('Brand', 'brand'), col('Category', 'category'),
      col('Status', 'status'), col('Primary', 'is_primary'), col('Driver code', 'driver_code'), col('Driver', 'driver_name'),
      col('Driver phone', 'driver_phone', phone), col('Added (UTC)', 'created_at', date),
    ],
  })
})

// The review queue only. Document links are never exported.
export const exportVehicleDocsPending = wrap(async (req, res) => {
  const rows = capped((await repo.listPendingVehicleDocs()) as unknown as Row[])
  await sendCsvExport(req, res, {
    entity: 'vehicle-docs-pending', targetTable: 'driver_vehicle_documents', filters: {}, rows,
    columns: [
      col('Driver code', 'driver_code'), col('Driver', 'driver_name'), col('Plate', 'number_plate'), col('Vehicle', 'vehicle_name'),
      col('Document', 'doc_type'), col('Uploaded (UTC)', 'created_at', date),
    ],
  })
})

export const exportSos = wrap(async (req, res) => {
  const status = str(req, 'status')
  if (status && !SOS_STATUSES.has(status)) throw httpError(400, 'Invalid status filter', 'VALIDATION_ERROR')
  const rows = await collectRows<Row>(async (limit, offset) => {
    const o: { status?: string; limit: number; offset: number } = { limit, offset }
    if (status) o.status = status
    return ((await getSosAlerts(o)) as unknown as { alerts: Row[] }).alerts
  })
  await sendCsvExport(req, res, {
    entity: 'sos', targetTable: 'sos_alerts', filters: status ? { status } : {}, rows,
    columns: [
      col('Alert ID', 'id'), col('Ride ID', 'ride_id'), col('Severity', 'severity'), col('Status', 'status'),
      col('Rider', 'user_name'), col('Rider phone', 'user_phone', phone), col('Driver', 'driver_name'), col('Driver phone', 'driver_phone', phone),
      col('Pickup', 'origin_address'), col('Drop', 'destination_address'), col('Notes', 'notes'),
      col('Triggered (UTC)', 'created_at', date), col('Acknowledged by', 'acknowledged_by_email'), col('Resolved by', 'resolved_by_email'),
      col('Resolved (UTC)', 'resolved_at', date), col('Resolution note', 'resolution_note'),
    ],
  })
})

export const exportDisputes = wrap(async (req, res) => {
  const status = str(req, 'status')
  if (status && !DISPUTE_STATUSES.has(status)) throw httpError(400, 'Invalid status filter', 'VALIDATION_ERROR')
  const mine = str(req, 'assignedToMe') === 'true'
  const rows = await collectRows<Row>(async (limit, offset) => {
    const o: { status?: string; assignedTo?: bigint; limit: number; offset: number } = { limit, offset }
    if (status) o.status = status
    if (mine) o.assignedTo = req.admin!.id
    return ((await getDisputes(o)) as unknown as { disputes: Row[] }).disputes
  })
  await sendCsvExport(req, res, {
    entity: 'disputes', targetTable: 'disputes', filters: { ...(status ? { status } : {}), ...(mine ? { assignedToMe: true } : {}) }, rows,
    columns: [
      col('Dispute ID', 'id'), col('Ride ID', 'ride_id'), col('Type', 'type'), col('Status', 'status'), col('Priority', 'priority'),
      col('Raised by', 'initiator'), col('Rider', 'user_name'), col('Driver', 'driver_name'), col('Description', 'description'),
      col('Assigned to', 'assigned_to_email'), col('SLA due (UTC)', 'sla_due_at', date), col('Outcome', 'outcome'),
      col('Outcome note', 'outcome_note'), col('Resolved (UTC)', 'resolved_at', date), col('Raised (UTC)', 'created_at', date),
    ],
  })
})

// Payout batches: with ?periodFrom&periodTo it is that batch's per-driver lines, otherwise the batch list. Bank details never.
export const exportPayouts = wrap(async (req, res) => {
  const from = str(req, 'periodFrom'); const to = str(req, 'periodTo')
  if (from && to) {
    if (!isDay(from) || !isDay(to)) throw httpError(400, 'Invalid period', 'VALIDATION_ERROR')
    const rows = capped((await getSettlementBatchDetail(from, to)) as Row[])
    await sendCsvExport(req, res, {
      entity: 'payout-batch', targetTable: 'settlements', filters: { periodFrom: from, periodTo: to }, rows,
      columns: [
        col('Settlement ID', 'id'), col('Driver ID', 'driver_id'), col('Driver', 'driver_name'), col('Net payout (INR)', 'net_payout', money),
        col('Fee (INR)', 'fee', money), col('Status', 'status'), col('Mode', 'mode'), col('UTR', 'utr'), col('Failure code', 'failure_code'),
        col('Created (UTC)', 'created_at', date),
      ],
    })
    return
  }
  const rows = (await listSettlementBatches()) as Row[]
  await sendCsvExport(req, res, {
    entity: 'payout-batches', targetTable: 'settlements', filters: {}, rows,
    columns: [
      col('Period from', 'period_from', day), col('Period to', 'period_to', day), col('Run type', 'run_type'),
      col('Status', 'status'), col('Drivers', 'driver_count'), col('Total (INR)', 'total', money),
    ],
  })
})
