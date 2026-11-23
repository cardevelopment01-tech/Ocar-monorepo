// The trip receipt as data: everything the PDF prints, worked out in one pure function so it can be unit-tested without a PDF.
// Fare rows mirror what the rider app shows (tripSummaryModel.buildInvoiceRows + rentalFareLines in @ocar/mobile-shared): only charges
// above zero, rental split into package / extra distance / extra time, and an "Adjustments" row for any gap so the rows ALWAYS add
// up to the total printed. An offer is a negative row after the subtotal.

type N = string | number | null | undefined

/** The ride row (snake_case, as getRideById returns it, after withTripWindow) fields a receipt reads. Everything is optional: old rides lack newer columns. */
export interface ReceiptRide {
  id: bigint | string
  status: string
  ride_type: 'one_way' | 'round_trip' | 'rental' | string
  trip_mode?: 'standard' | 'city' | string | null
  trip_hours?: N
  requested_at?: string | null
  started_at?: string | null
  completed_at?: string | null
  cancelled_at?: string | null
  driver_arrived_at?: string | null
  drop_arrived_at?: string | null
  origin_address?: string | null
  destination_address?: string | null
  origin_lat?: N; origin_lng?: N; dest_lat?: N; dest_lng?: N
  payment_channel?: 'cash' | 'online' | 'wallet' | string | null
  payment_status?: string | null
  cash_collected_at?: string | null
  user_name?: string | null
  driver_name?: string | null
  driver_rating?: N
  vehicle_number_plate?: string | null
  vehicle_name?: string | null
  vehicle_model?: string | null
  vehicle_brand?: string | null
  booked_category_name?: string | null
  assigned_category_name?: string | null
  total_estimated?: N; total_final?: N; discount_amount?: N
  base_fare?: N; distance_fare?: N; time_fare?: N; stop_fare?: N; hour_surcharge?: N; overage_fare?: N
  surge_fare?: N; surge_multiplier?: N; waiting_fare?: N
  actual_km?: N; actual_min?: N
  overage_km?: N; overage_min?: N; rental_extra_per_km?: N; rental_extra_per_min?: N
  rental_km_limit?: N; rental_duration_minutes?: N
  pickup_wait_min?: N; pickup_free_wait_min?: N; pickup_wait_charge?: N
  toll_charge?: N; toll_detail?: Array<{ zone: string; amount: number }> | null
  bookedUntil?: string | null; overtimeMin?: number | null; overtimeFare?: number | null; overtimeGraceMin?: number | null
  cancellation_fee?: N
  cancellation_reason?: string | null
  cancellation_actor?: string | null
}

export interface ReceiptStopRow {
  sequence: number; address: string | null; arrived_at?: string | null; reached_at?: string | null; wait_charge?: N; stop_charge_applied?: N; status?: string
  lat?: N; lng?: N
}

export type Tone = 'good' | 'due' | 'neutral'
export interface FareRow { key: string; label: string; detail?: string; amount: number }
export interface TimelineItem { time: string; label: string; address: string; kind: 'start' | 'stop' | 'end'; note?: string }
export interface UsageBar { label: string; used: string; extra: string; /** used as a percent of what was included (>= 100 when over) */ pct: number }
export interface ReceiptModel {
  kind: 'trip' | 'cancelled'
  tripNo: string
  dateLabel: string
  issuedLabel: string
  firstName: string
  heroLabel: string
  total: number
  status: { text: string; tone: Tone }
  method: string
  paidLabel: string
  note: string | null
  saved: number
  timeline: TimelineItem[]
  facts: Array<{ label: string; value: string }>
  package: { title: string; sub: string; bars: UsageBar[] } | null
  rows: FareRow[]
  /** Shown between the rows and the offer when there is an offer: the fare before it. */
  offer: number
  sumLabel: string
  driver: { name: string; rating: string | null; vehicle: string; plate: string | null } | null
  trail: Array<[number, number]>
  pins: Array<{ lat: number; lng: number; kind: 'start' | 'stop' | 'end' }>
}

const num = (v: N): number => {
  if (v == null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}
const r2 = (n: number) => Math.round(n * 100) / 100

const TZ = 'Asia/Kolkata'
const fmt = (iso: string | null | undefined, o: Intl.DateTimeFormatOptions): string => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat('en-IN', { timeZone: TZ, ...o }).format(d)
}
export const clock = (iso: string | null | undefined) => fmt(iso, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/ /g, ' ').toLowerCase()
export const dayLabel = (iso: string | null | undefined) => fmt(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/, (\d{4})$/, ' $1')
export const dayTime = (iso: string | null | undefined) => `${fmt(iso, { day: 'numeric', month: 'short', year: 'numeric' })}, ${clock(iso)}`

/** Money like the app's formatMoney: whole rupees drop the decimals, paise keep two, Indian grouping. */
export function money(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005
  return `₹${Math.abs(n).toLocaleString('en-IN', whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const rupeeRate = (n: number) => (Number.isInteger(n) ? `₹${n}` : `₹${n.toFixed(2)}`)
const trimKm = (km: number) => `${Math.round(km * 100) / 100} km`
const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')} min` : ''}`)
const hmShort = (min: number) => (min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`)

function rentalRows(r: ReceiptRide): FareRow[] | null {
  if (r.ride_type !== 'rental') return null
  const rows: FareRow[] = []
  const pkg = num(r.base_fare)
  const mins = num(r.rental_duration_minutes)
  const km = num(r.rental_km_limit)
  const detail = [mins > 0 ? (mins % 60 === 0 ? `${mins / 60} h` : hm(mins)) : '', km > 0 ? `${km} km included` : ''].filter(Boolean).join(' · ')
  if (pkg > 0) rows.push({ key: 'package', label: 'Package price', ...(detail ? { detail } : {}), amount: pkg })
  const overage = num(r.overage_fare)
  if (overage <= 0) return rows
  const perKm = num(r.rental_extra_per_km), perMin = num(r.rental_extra_per_min)
  const oKm = num(r.overage_km), oMin = Math.round(num(r.overage_min))
  const kmAmt = r2(oKm * perKm), minAmt = r2(oMin * perMin)
  // Split only when the parts add up to what was billed (older rentals stored no rates); otherwise one honest line.
  if (oKm * perKm + oMin * perMin <= 0 || Math.abs(kmAmt + minAmt - overage) >= 1) {
    rows.push({ key: 'extra', label: 'Extra distance or time', amount: overage })
    return rows
  }
  const crumb = r2(overage - kmAmt - minAmt)
  const kmFinal = kmAmt >= minAmt ? r2(kmAmt + crumb) : kmAmt
  const minFinal = kmAmt >= minAmt ? minAmt : r2(minAmt + crumb)
  if (kmFinal > 0) rows.push({ key: 'extra-km', label: 'Extra distance', detail: `${trimKm(oKm)} × ${rupeeRate(perKm)}`, amount: kmFinal })
  if (minFinal > 0) rows.push({ key: 'extra-time', label: 'Extra time', detail: `${oMin} min × ${rupeeRate(perMin)}`, amount: minFinal })
  return rows
}

export function buildFareRows(r: ReceiptRide, stops: ReceiptStopRow[]): { rows: FareRow[]; gross: number; discount: number; payable: number } {
  const gross = r2(num(r.total_final ?? r.total_estimated))
  const discount = r2(Math.min(num(r.discount_amount), gross))
  const km = num(r.actual_km)
  const min = Math.round(num(r.actual_min))
  const surge = num(r.surge_multiplier)
  const grace = r.overtimeGraceMin
  const stopWait = r2(stops.reduce((s, st) => s + num(st.wait_charge), 0))
  // Stops that were charged (a stop charge already added stays after a skip), else the stops that were made.
  const charged = stops.filter((s) => num(s.stop_charge_applied) > 0).length
  const extraStops = charged > 0 ? charged : stops.filter((s) => s.status !== 'skipped').length
  const rental = rentalRows(r)

  // Receipt layout: the trip itself is ONE "Ride fare" line (base fare, distance, time, extra stops, waiting, surge, allowances all
  // inside it); only what is charged on top of it (airport toll, extra distance, extra time) is listed underneath, each with its
  // charge. The ride fare is the settled total MINUS those lines, never the sum of the quoted components: settlement reprices a
  // trip on the distance and time actually driven but leaves the quoted component amounts on the snapshot, so adding those up
  // printed a stale figure and an unexplained "Adjustments" row.
  const overtime = (r.overtimeMin ?? 0) > 0 ? num(r.overtimeFare) : 0
  const below: FareRow[] = [
    { key: 'toll', label: 'Airport toll', ...(r.toll_detail?.length && { detail: r.toll_detail.map((t) => t.zone).join(', ') }), amount: num(r.toll_charge) },
    // Only a rental's extra distance/time is itemised: settleRentalFare writes it at settlement. Any other ride type's overage_fare
    // is the quoted figure (settlement reprices the total but not that column), so it stays inside the Ride fare.
    ...(rental ? rental.filter((x) => x.key !== 'package') : []),
    // Overtime is not surged. Only present once the trip settled with time past the booked window.
    { key: 'overtime', label: 'Extra time', detail: `${num(r.overtimeMin)} min${grace ? `, after ${grace} free minutes` : ''}`, amount: overtime },
  ].filter((c) => c.amount > 0).map((x) => ({ ...x, amount: r2(x.amount) }))

  const waited = r2(stopWait + num(r.pickup_wait_charge))
  const pkgDetail = rental?.find((x) => x.key === 'package')?.detail
  const hours = num(r.trip_hours)
  const detail = [
    pkgDetail ?? '',
    !rental && km > 0 ? trimKm(km) : '',
    !rental && min > 0 ? `${min} min` : '',
    !rental && hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'} booked` : '',
    extraStops > 0 ? `${extraStops} ${extraStops === 1 ? 'stop' : 'stops'}` : '',
    surge > 1 ? `${surge}× surge` : '',
    waited > 0 ? `incl. ${money(waited)} waiting` : '',
  ].filter(Boolean).join(' · ')
  const rideFare = r2(gross - below.reduce((n, c) => n + c.amount, 0))
  let rows: FareRow[] = [...(rideFare > 0 ? [{ key: 'ride-fare', label: 'Ride fare', ...(detail ? { detail } : {}), amount: rideFare }] : []), ...below]
  // The rows must add up to the total printed. Only possible now if the lines below exceed the total: a gap of a rupee or more is
  // shown as its own "Adjustments" row; anything smaller is rounding, folded into the largest row.
  const gap = r2(gross - rows.reduce((n, c) => n + c.amount, 0))
  if (Math.abs(gap) >= 1) rows.push({ key: 'adjust', label: 'Adjustments', amount: gap })
  else if (gap !== 0 && rows.length > 0) {
    const big = rows.reduce((m, c, i) => (c.amount > rows[m]!.amount ? i : m), 0)
    rows = rows.map((c, i) => (i === big ? { ...c, amount: r2(c.amount + gap) } : c))
  }
  return { rows, gross, discount, payable: r2(gross - discount) }
}

function ridePointLabel(r: ReceiptRide, i: number, last: number): string {
  if (r.ride_type === 'round_trip') return i === 0 ? 'Left pickup' : i === last ? 'Back at pickup' : 'Reached destination'
  if (r.ride_type === 'rental') return i === 0 ? 'Picked up' : i === last ? 'Ended' : `Stop ${i}`
  return i === 0 ? 'Picked up' : i === last ? 'Dropped off' : `Stop ${i}`
}

const rideTypeLabel = (r: ReceiptRide) =>
  r.ride_type === 'round_trip' ? 'Round trip' : r.ride_type === 'rental' ? 'Rental' : r.trip_mode === 'city' ? 'City ride' : 'One way'

export function buildReceipt(
  r: ReceiptRide,
  stops: ReceiptStopRow[],
  trail: Array<[number, number]>,
  now: Date = new Date(),
): ReceiptModel {
  const cancelled = r.status === 'cancelled' || r.status === 'no_drivers'
  // A stray (0,0) or out-of-range fix would stretch the route panel across the Atlantic and shrink the real trip to a dot.
  const cleanTrail = trail.filter(([la, ln]) => Number.isFinite(la) && Number.isFinite(ln) && Math.abs(la) <= 90 && Math.abs(ln) <= 180 && !(la === 0 && ln === 0))
  const channel = r.payment_channel ?? 'cash'
  const when = r.completed_at ?? r.cancelled_at ?? r.requested_at ?? null
  const tripNo = `#${String(r.id)}`
  const cat = r.assigned_category_name ?? r.booked_category_name ?? ''

  const fee = r2(num(r.cancellation_fee))
  const built = cancelled
    ? { rows: fee > 0 ? [{ key: 'fee', label: 'Cancellation fee', amount: fee } as FareRow] : [], gross: fee, discount: 0, payable: fee }
    : buildFareRows(r, stops)

  // Payment: cash is "due" until the driver marks it collected; online and wallet are paid once the payment completed.
  let status: ReceiptModel['status']
  let method: string
  let paidLabel: string
  if (cancelled) {
    const settled = r.payment_status === 'completed'
    status = { text: settled ? 'Charged' : 'Fee applies', tone: 'neutral' }
    method = channel === 'wallet' ? 'Ocar wallet' : channel === 'online' ? 'Online' : 'Cash'
    paidLabel = dayTime(when)
  } else if (channel === 'cash') {
    const done = !!r.cash_collected_at
    status = done ? { text: 'Paid', tone: 'good' } : { text: 'Cash due', tone: 'due' }
    method = done ? 'Cash' : 'Pay the driver in cash'
    paidLabel = done ? dayTime(r.cash_collected_at) : 'Collected when the trip ends'
  } else {
    const done = r.payment_status === 'completed'
    status = done ? { text: 'Paid', tone: 'good' } : { text: r.payment_status === 'failed' ? 'Payment failed' : 'Payment pending', tone: 'due' }
    method = channel === 'wallet' ? 'Ocar wallet' : 'Online'
    paidLabel = done ? dayTime(when) : ''
  }
  const paidWord = cancelled ? 'Cancellation fee' : status.tone === 'good' ? 'Total paid' : 'Total due'

  // Route and times
  const timeline: TimelineItem[] = []
  const pins: ReceiptModel['pins'] = []
  const origin = { lat: num(r.origin_lat), lng: num(r.origin_lng) }
  const dest = { lat: num(r.dest_lat), lng: num(r.dest_lng) }
  const real = stops.filter((s) => s.status !== 'skipped')
  const seq: Array<{ time: string; address: string | null; note?: string; lat?: number; lng?: number }> = []
  const pickupWait = Math.round(num(r.pickup_wait_min))
  seq.push({ time: clock(r.started_at ?? r.driver_arrived_at), address: r.origin_address ?? null, ...(pickupWait > 0 ? { note: `Driver waited ${pickupWait} min at pickup` } : {}), ...origin })
  for (const s of real) {
    const waitedMin = s.arrived_at && s.reached_at ? Math.round((new Date(s.reached_at).getTime() - new Date(s.arrived_at).getTime()) / 60000) : 0
    seq.push({ time: clock(s.reached_at ?? s.arrived_at), address: s.address ?? null, ...(waitedMin > 0 ? { note: `Waited ${waitedMin} min` } : {}), lat: num(s.lat), lng: num(s.lng) })
  }
  if (r.ride_type === 'round_trip' && r.drop_arrived_at) seq.push({ time: clock(r.drop_arrived_at), address: r.destination_address ?? null, ...dest })
  seq.push({ time: clock(r.completed_at), address: r.ride_type === 'round_trip' ? r.origin_address ?? null : r.destination_address ?? null, ...(r.ride_type === 'round_trip' ? origin : dest) })
  const last = seq.length - 1
  seq.forEach((p, i) => {
    const kind: TimelineItem['kind'] = i === 0 ? 'start' : i === last ? 'end' : 'stop'
    timeline.push({ time: cancelled ? '' : p.time, label: cancelled ? (i === 0 ? 'Pickup' : 'Drop') : ridePointLabel(r, i, last), address: p.address ?? '', kind, ...(p.note ? { note: p.note } : {}) })
    if (p.lat != null && p.lng != null && (p.lat !== 0 || p.lng !== 0)) pins.push({ lat: p.lat, lng: p.lng, kind })
  })
  if (cancelled) { timeline.length = 0; timeline.push({ time: '', label: 'Pickup', address: r.origin_address ?? '', kind: 'start' }, { time: '', label: 'Drop', address: r.destination_address ?? '', kind: 'end' }) }

  // Facts
  const measured = Math.round(num(r.actual_min))
  const gap = r.started_at && r.completed_at ? Math.round((new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()) / 60000) : 0
  const durationMin = measured > 0 ? measured : gap > 0 ? gap : 0
  const km = num(r.actual_km)
  const facts: ReceiptModel['facts'] = cancelled
    ? [
        ...(r.requested_at ? [{ label: 'Booked', value: clock(r.requested_at) }] : []),
        ...(r.cancelled_at ? [{ label: 'Cancelled', value: clock(r.cancelled_at) }] : []),
        { label: 'Ride type', value: rideTypeLabel(r) },
        ...(cat ? [{ label: 'Vehicle', value: cat }] : []),
      ]
    : [
        ...(km > 0 ? [{ label: 'Distance', value: trimKm(Math.round(km * 10) / 10) }] : []),
        ...(durationMin > 0 ? [{ label: 'Time taken', value: hmShort(durationMin) }] : []),
        { label: 'Ride type', value: rideTypeLabel(r) },
        ...(cat ? [{ label: 'Vehicle', value: cat }] : []),
      ]

  // Package / window bars
  let pkg: ReceiptModel['package'] = null
  if (!cancelled && r.ride_type === 'rental' && num(r.rental_duration_minutes) > 0) {
    const incMin = num(r.rental_duration_minutes), incKm = num(r.rental_km_limit)
    const bars: UsageBar[] = []
    if (incKm > 0 && km > incKm) bars.push({ label: 'Distance', used: trimKm(Math.round(km * 10) / 10), extra: trimKm(Math.round((km - incKm) * 10) / 10), pct: (km / incKm) * 100 })
    if (durationMin > incMin) bars.push({ label: 'Time', used: hmShort(durationMin), extra: `${durationMin - incMin} min`, pct: (durationMin / incMin) * 100 })
    pkg = { title: `${incMin % 60 === 0 ? `${incMin / 60} hour` : hm(incMin)}${incKm > 0 ? ` · ${incKm} km package` : ' package'}`, sub: '', bars }
  } else if (!cancelled && r.ride_type === 'round_trip' && num(r.trip_hours) > 0 && (r.overtimeMin ?? 0) > 0 && r.bookedUntil) {
    const booked = num(r.trip_hours) * 60
    pkg = { title: `Booked for ${num(r.trip_hours)} ${num(r.trip_hours) === 1 ? 'hour' : 'hours'}`, sub: `until ${clock(r.bookedUntil)}`, bars: [{ label: 'Time', used: hmShort(Math.round(booked + (r.overtimeMin ?? 0))), extra: `${r.overtimeMin} min`, pct: ((booked + (r.overtimeMin ?? 0)) / booked) * 100 }] }
  }

  const vehicle = [r.vehicle_brand, r.vehicle_model].filter(Boolean).join(' ') || r.vehicle_name || cat
  const driver = r.driver_name
    ? { name: r.driver_name, rating: cancelled || num(r.driver_rating) <= 0 ? null : num(r.driver_rating).toFixed(2).replace(/0$/, ''), vehicle: vehicle ?? '', plate: r.vehicle_number_plate ?? null }
    : null

  const note = cancelled
    ? `${r.cancellation_reason ?? (r.cancellation_actor === 'user' ? 'Cancelled by you' : 'This trip was cancelled')}.${fee > 0 ? ' No other charges apply.' : ''}`
    : null

  return {
    kind: cancelled ? 'cancelled' : 'trip',
    tripNo,
    dateLabel: dayLabel(when),
    issuedLabel: dayTime(now.toISOString()),
    firstName: (r.user_name ?? '').trim().split(/\s+/)[0] ?? '',
    heroLabel: paidWord,
    total: built.payable,
    status, method, paidLabel, note,
    saved: built.discount,
    timeline, facts, package: pkg,
    rows: built.rows,
    offer: built.discount,
    sumLabel: cancelled ? 'Total charged' : built.discount > 0 ? paidWord : 'Total ride fare',
    driver,
    trail: cleanTrail.length >= 2 ? cleanTrail : [],
    pins,
  }
}
