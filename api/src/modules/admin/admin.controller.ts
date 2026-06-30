import { Request, Response, NextFunction } from 'express'
import * as service        from './admin.service'
import * as sosService     from '@/modules/safety/sos.service'
import * as disputeService from '@/modules/safety/disputes.service'
import type { DriverStatus } from './admin.types'
import type { DisputeOutcome } from '@/modules/safety/safety.types'

export async function getDrivers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q: { status?: string; search?: string; page?: number; limit?: number } = {}
    if (req.query['status'])  q.status = req.query['status']  as string
    if (req.query['search'])  q.search = req.query['search']  as string
    if (req.query['page'])    q.page   = parseInt(req.query['page']  as string, 10)
    if (req.query['limit'])   q.limit  = parseInt(req.query['limit'] as string, 10)
    const result = await service.listDrivers(q)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function getDriver(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const driver = await service.getDriver(BigInt(req.params['id']!))
    res.json(driver)
  } catch (err) {
    next(err)
  }
}

export async function updateDriverStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const driverId = BigInt(req.params['id']!)
    const adminId  = req.admin!.id
    const driver = await service.getDriver(driverId)
    const payload: { status: DriverStatus; reason?: string } = { status: req.body.status as DriverStatus }
    if (req.body.reason !== undefined) payload.reason = String(req.body.reason)
    await service.updateDriverStatus(driverId, adminId, driver.status as DriverStatus, payload)
    res.json({ success: true, status: req.body.status })
  } catch (err) {
    next(err)
  }
}

// ─── Vehicle controllers ──────────────────────────────────────────────────────

export async function getCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.listCategories()) } catch (err) { next(err) }
}

export async function postCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cat = await service.createCategory({
      slug: String(req.body.slug ?? '').toLowerCase().replace(/\s+/g, '-'),
      display_name: String(req.body.display_name ?? ''),
      max_passengers: Number(req.body.max_passengers ?? 4),
      is_active: req.body.is_active !== false,
    })
    res.status(201).json(cat)
  } catch (err) { next(err) }
}

export async function patchCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const catData: { display_name?: string; max_passengers?: number; is_active?: boolean } = {}
    if (req.body.display_name !== undefined) catData.display_name = String(req.body.display_name)
    if (req.body.max_passengers != null) catData.max_passengers = Number(req.body.max_passengers)
    if (req.body.is_active !== undefined) catData.is_active = Boolean(req.body.is_active)
    const cat = await service.updateCategory(BigInt(req.params['id']!), catData)
    res.json(cat)
  } catch (err) { next(err) }
}

export async function getBrands(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.listBrands()) } catch (err) { next(err) }
}

export async function postBrand(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const brand = await service.createBrand({
      name: String(req.body.name ?? ''),
      is_active: req.body.is_active !== false,
    })
    res.status(201).json(brand)
  } catch (err) { next(err) }
}

export async function patchBrand(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const brandData: { name?: string; is_active?: boolean } = {}
    if (req.body.name !== undefined) brandData.name = String(req.body.name)
    if (req.body.is_active !== undefined) brandData.is_active = Boolean(req.body.is_active)
    const brand = await service.updateBrand(BigInt(req.params['id']!), brandData)
    res.json(brand)
  } catch (err) { next(err) }
}

export async function getModels(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listModels(req.query['brand_id'] as string | undefined))
  } catch (err) { next(err) }
}

export async function postModel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const model = await service.createModel({
      brand_id: String(req.body.brand_id ?? ''),
      name: String(req.body.name ?? ''),
      typical_category_id: req.body.typical_category_id ? String(req.body.typical_category_id) : null,
      is_active: req.body.is_active !== false,
    })
    res.status(201).json(model)
  } catch (err) { next(err) }
}

export async function patchModel(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data: { name?: string; typical_category_id?: string | null; is_active?: boolean } = {}
    if (req.body.name !== undefined) data.name = String(req.body.name)
    if ('typical_category_id' in req.body) data.typical_category_id = req.body.typical_category_id ? String(req.body.typical_category_id) : null
    if (req.body.is_active !== undefined) data.is_active = Boolean(req.body.is_active)
    res.json(await service.updateModel(BigInt(req.params['id']!), data))
  } catch (err) { next(err) }
}

export async function getFleet(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listFleet(req.query['status'] as string | undefined))
  } catch (err) { next(err) }
}

export async function blacklistVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.blacklistVehicle(
      BigInt(req.params['vehicleId']!), req.admin!.id, String(req.body.reason ?? '')
    )
    res.json({ success: true, vehicle_id: req.params['vehicleId'], ...result })
  } catch (err) { next(err) }
}

export async function unblacklistVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.unblacklistVehicle(BigInt(req.params['vehicleId']!))
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function getPendingVehicleDocs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.listPendingVehicleDocs()) } catch (err) { next(err) }
}

export async function approveDriverDoc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.approveDriverDoc(BigInt(req.params['docId']!), req.admin!.id)
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function rejectDriverDoc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.rejectDriverDoc(
      BigInt(req.params['docId']!), req.admin!.id, String(req.body.rejection_note ?? '')
    )
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function approveVehicleDoc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.approveVehicleDoc(BigInt(req.params['docId']!), req.admin!.id)
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function rejectVehicleDoc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.rejectVehicleDoc(
      BigInt(req.params['docId']!), req.admin!.id, String(req.body.rejection_note ?? '')
    )
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function getExpiringDocs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const daysAhead = req.query['days_ahead'] ? parseInt(req.query['days_ahead'] as string, 10) : 30
    res.json(await service.listExpiringDocs(daysAhead))
  } catch (err) { next(err) }
}

// ─── Geo / Cities ─────────────────────────────────────────────────────────────

// ─── Pricing ──────────────────────────────────────────────────────────────────

export async function getAdminRateCards(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.listAdminRateCards()) } catch (err) { next(err) }
}

export async function getAdminRateCardHistory(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.listAdminRateCardHistory()) } catch (err) { next(err) }
}

export async function postAdminRateCard(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data: { returnRatePerKm?: number | null; hourRate?: number | null; notes?: string | null } = {}
    if (req.body.return_rate_per_km !== undefined) data.returnRatePerKm = req.body.return_rate_per_km != null ? Number(req.body.return_rate_per_km) : null
    if (req.body.hour_rate !== undefined)          data.hourRate        = req.body.hour_rate != null ? Number(req.body.hour_rate) : null
    if (req.body.notes !== undefined)              data.notes           = String(req.body.notes)
    const card = await service.createAdminRateCard({
      categoryId:  Number(req.body.category_id),
      rideType:    String(req.body.ride_type),
      ratePerKm:   Number(req.body.rate_per_km),
      ratePerMin:  Number(req.body.rate_per_min),
      minFare:     Number(req.body.min_fare),
      adminId:     req.admin!.id,
      ...data,
    })
    res.status(201).json(card)
  } catch (err) { next(err) }
}

export async function getAdminSurgeEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.listAdminSurgeEvents()) } catch (err) { next(err) }
}

export async function postAdminSurgeEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const surge = await service.createAdminSurgeEvent({
      cityId:     Number(req.body.city_id),
      categoryId: req.body.category_id != null ? Number(req.body.category_id) : null,
      multiplier: Number(req.body.multiplier),
      reason:     req.body.reason ? String(req.body.reason) : null,
      startsAt:   String(req.body.starts_at),
      endsAt:     String(req.body.ends_at),
      adminId:    req.admin!.id,
    })
    res.status(201).json(surge)
  } catch (err) { next(err) }
}

export async function cancelAdminSurgeEvent(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.cancelAdminSurgeEvent(BigInt(req.params['id']!), req.admin!.id))
  } catch (err) { next(err) }
}

export async function getAdminCities(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.listAdminCities()) } catch (err) { next(err) }
}

export async function postAdminCity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const city = await service.createAdminCity({
      name:                    String(req.body.name ?? ''),
      slug:                    String(req.body.slug ?? '').toLowerCase().replace(/\s+/g, '-'),
      state:                   String(req.body.state ?? ''),
      centroid_lat:            Number(req.body.centroid_lat),
      centroid_lng:            Number(req.body.centroid_lng),
      default_speed_limit_kmph: Number(req.body.default_speed_limit_kmph ?? 50),
      is_rental_enabled:       req.body.is_rental_enabled === true,
      is_return_cab_enabled:   req.body.is_return_cab_enabled === true,
      created_by:              req.admin!.id,
    })
    res.status(201).json(city)
  } catch (err) { next(err) }
}

export async function patchAdminCity(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data: {
      name?: string; state?: string; default_speed_limit_kmph?: number
      status?: string; is_rental_enabled?: boolean; is_return_cab_enabled?: boolean
    } = {}
    if (req.body.name !== undefined)                    data.name = String(req.body.name)
    if (req.body.state !== undefined)                   data.state = String(req.body.state)
    if (req.body.default_speed_limit_kmph !== undefined) data.default_speed_limit_kmph = Number(req.body.default_speed_limit_kmph)
    if (req.body.status !== undefined)                  data.status = String(req.body.status)
    if (req.body.is_rental_enabled !== undefined)       data.is_rental_enabled = Boolean(req.body.is_rental_enabled)
    if (req.body.is_return_cab_enabled !== undefined)   data.is_return_cab_enabled = Boolean(req.body.is_return_cab_enabled)
    res.json(await service.updateAdminCity(BigInt(req.params['id']!), data))
  } catch (err) { next(err) }
}

// ─── Admin Safety — SOS ───────────────────────────────────────────────────────

export async function getAdminSosAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const opts: { status?: string; limit: number; offset: number } = {
      limit:  parseInt(req.query['limit']  as string ?? '20', 10),
      offset: parseInt(req.query['offset'] as string ?? '0',  10),
    }
    if (req.query['status']) opts.status = req.query['status'] as string
    res.json(await sosService.listSosAlerts(opts))
  } catch (err) { next(err) }
}

export async function acknowledgeAdminSos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const alert = await sosService.acknowledgeSosAlert(BigInt(req.params['id']!), req.admin!.id)
    res.json(alert)
  } catch (err) { next(err) }
}

export async function resolveAdminSos(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = req.body.status === 'false_alarm' ? 'false_alarm' as const : 'resolved' as const
    const note   = req.body.note ? String(req.body.note) : undefined
    const alert  = await sosService.resolveSosAlert(BigInt(req.params['id']!), req.admin!.id, status, note)
    res.json(alert)
  } catch (err) { next(err) }
}

// ─── Admin Safety — Disputes ──────────────────────────────────────────────────

export async function getAdminDisputes(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const opts: { status?: string; assignedTo?: bigint; limit: number; offset: number } = {
      limit:  parseInt(req.query['limit']  as string ?? '20', 10),
      offset: parseInt(req.query['offset'] as string ?? '0',  10),
    }
    if (req.query['status'])      opts.status     = req.query['status'] as string
    if (req.query['assignedToMe'] === 'true') opts.assignedTo = req.admin!.id
    res.json(await disputeService.listDisputes(opts))
  } catch (err) { next(err) }
}

export async function getAdminDispute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await disputeService.getDispute(BigInt(req.params['id']!)))
  } catch (err) { next(err) }
}

export async function assignAdminDispute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await disputeService.assignDispute(BigInt(req.params['id']!), req.admin!.id))
  } catch (err) { next(err) }
}

export async function resolveAdminDispute(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as {
      outcome:       string
      note:          string
      refundAmount?: number
    }
    if (!body.outcome || !body.note) {
      res.status(400).json({ error: 'outcome and note are required', code: 'VALIDATION_ERROR' })
      return
    }
    const input: Parameters<typeof disputeService.resolveDispute>[1] = {
      outcome: body.outcome as DisputeOutcome,
      note:    String(body.note),
      adminId: req.admin!.id,
    }
    if (body.refundAmount !== undefined) input.refundAmount = Number(body.refundAmount)
    res.json(await disputeService.resolveDispute(BigInt(req.params['id']!), input))
  } catch (err) { next(err) }
}

// ─── Admin Rides ──────────────────────────────────────────────────────────────

export async function getAdminRides(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q: { status?: string; search?: string; page?: number; limit?: number } = {}
    if (req.query['status']) q.status = req.query['status'] as string
    if (req.query['search']) q.search = req.query['search'] as string
    if (req.query['page'])   q.page   = parseInt(req.query['page'] as string, 10)
    if (req.query['limit'])  q.limit  = parseInt(req.query['limit'] as string, 10)
    res.json(await service.listAdminRides(q))
  } catch (err) { next(err) }
}

// ─── Admin Users ──────────────────────────────────────────────────────────────

export async function getAdminUsers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q: { status?: string; search?: string; page?: number; limit?: number } = {}
    if (req.query['status']) q.status = req.query['status'] as string
    if (req.query['search']) q.search = req.query['search'] as string
    if (req.query['page'])   q.page   = parseInt(req.query['page'] as string, 10)
    if (req.query['limit'])  q.limit  = parseInt(req.query['limit'] as string, 10)
    res.json(await service.listAdminUsers(q))
  } catch (err) { next(err) }
}

export async function patchAdminUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.updateAdminUserStatus(BigInt(req.params['id']!), String(req.body.status ?? ''))
    res.json({ success: true, ...result })
  } catch (err) { next(err) }
}

// ─── Admin Payments ───────────────────────────────────────────────────────────

export async function getAdminPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q: { channel?: string; search?: string; page?: number; limit?: number } = {}
    if (req.query['channel']) q.channel = req.query['channel'] as string
    if (req.query['search'])  q.search  = req.query['search'] as string
    if (req.query['page'])    q.page    = parseInt(req.query['page'] as string, 10)
    if (req.query['limit'])   q.limit   = parseInt(req.query['limit'] as string, 10)
    res.json(await service.listAdminPayments(q))
  } catch (err) { next(err) }
}

export async function getAdminStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await service.getDashboardStats()
    res.json(stats)
  } catch (err) { next(err) }
}

export async function getAdminActiveSessions(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const sessions = await service.getActiveSessions()
    res.json({ sessions })
  } catch (err) { next(err) }
}
