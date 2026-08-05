import { Request, Response, NextFunction } from 'express'
import * as service        from './admin.service'
import * as sosService     from '@/modules/safety/sos.service'
import * as disputeService from '@/modules/safety/disputes.service'
import * as adminAuditService from '@/modules/admin-audit/admin-audit.service'
import type { DriverStatus, UpdateDriverProfilePayload, UpdateDriverVehiclePayload } from './admin.types'
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
    await service.updateDriverStatus(driverId, adminId, driver.status as DriverStatus, payload, req.ip ?? null)
    res.json({ success: true, status: req.body.status })
  } catch (err) {
    next(err)
  }
}

const PROFILE_STRING_FIELDS = [
  'full_name', 'email', 'gender', 'date_of_birth', 'residential_address',
  'state', 'city', 'pincode', 'emergency_contact', 'aadhaar_number', 'license_number',
] as const

export async function updateDriverProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const driverId = BigInt(req.params['id']!)
    const adminId  = req.admin!.id
    const body = req.body as Record<string, unknown>

    const payload: UpdateDriverProfilePayload = { reason: String(body['reason'] ?? '') }
    for (const field of PROFILE_STRING_FIELDS) {
      if (body[field] !== undefined) payload[field] = String(body[field])
    }
    if (body['experience_years'] !== undefined) {
      const years = Number(body['experience_years'])
      if (isNaN(years)) throw Object.assign(new Error('experience_years must be a number'), { httpStatus: 400 })
      payload.experience_years = years
    }
    if (body['languages_known'] !== undefined) payload.languages_known = body['languages_known'] as string[]

    await service.updateDriverProfile(driverId, adminId, payload, req.ip ?? null)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}

const VEHICLE_STRING_FIELDS = ['category_id', 'brand_id', 'vehicle_name', 'number_plate', 'color', 'fuel_type'] as const
const VEHICLE_NUMBER_FIELDS = ['model_year', 'seating_capacity', 'luggage_capacity'] as const

export async function updateDriverVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const driverId = BigInt(req.params['id']!)
    const adminId  = req.admin!.id
    const driver = await service.getDriver(driverId)
    if (!driver.vehicle) throw Object.assign(new Error('Driver has no vehicle registered'), { httpStatus: 404 })

    const body = req.body as Record<string, unknown>
    const payload: UpdateDriverVehiclePayload = { reason: String(body['reason'] ?? '') }

    for (const field of VEHICLE_STRING_FIELDS) {
      if (body[field] !== undefined) payload[field] = String(body[field])
    }
    for (const field of VEHICLE_NUMBER_FIELDS) {
      if (body[field] !== undefined) {
        const n = Number(body[field])
        if (isNaN(n)) throw Object.assign(new Error(`${field} must be a number`), { httpStatus: 400 })
        payload[field] = n
      }
    }
    if (body['ac_availability'] !== undefined) payload.ac_availability = Boolean(body['ac_availability'])
    if ('model_id' in body) payload.model_id = body['model_id'] ? String(body['model_id']) : null

    await service.updateDriverVehicle(driverId, BigInt(driver.vehicle.id), adminId, payload, req.ip ?? null)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}

function pageQuery(req: Request): { page?: number; limit?: number } {
  const q: { page?: number; limit?: number } = {}
  if (req.query['page'])  q.page  = parseInt(req.query['page']  as string, 10)
  if (req.query['limit']) q.limit = parseInt(req.query['limit'] as string, 10)
  return q
}

export async function getDriverRides(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.listDriverRides(BigInt(req.params['id']!), pageQuery(req))
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function getDriverPayments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.listDriverPayments(BigInt(req.params['id']!), pageQuery(req))
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function getDriverAuditLog(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await adminAuditService.listAuditLogForTarget('drivers', BigInt(req.params['id']!), pageQuery(req))
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function getAdminAccounts(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const admins = await service.listAdminAccounts()
    res.json({ admins })
  } catch (err) {
    next(err)
  }
}

export async function patchAdminStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const admin = await service.setAdminStatus({
      targetId: BigInt(req.params['id']!),
      status: req.body.status as 'active' | 'suspended',
      actingAdminId: req.admin!.id,
      ipAddress: req.ip ?? null,
    })
    res.json({ admin })
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
    await service.approveDriverDoc(BigInt(req.params['docId']!), req.admin!.id, req.ip ?? null)
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function rejectDriverDoc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.rejectDriverDoc(
      BigInt(req.params['docId']!), req.admin!.id, String(req.body.rejection_note ?? ''), req.ip ?? null
    )
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function approveVehicleDoc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.approveVehicleDoc(BigInt(req.params['docId']!), req.admin!.id, req.ip ?? null)
    res.json({ success: true })
  } catch (err) { next(err) }
}

export async function rejectVehicleDoc(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.rejectVehicleDoc(
      BigInt(req.params['docId']!), req.admin!.id, String(req.body.rejection_note ?? ''), req.ip ?? null
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
    const data: { returnRatePerKm?: number | null; hourRate?: number | null; kmPerDay?: number | null; driverAllowancePerDay?: number | null; cityId?: number | null; notes?: string | null } = {}
    if (req.body.return_rate_per_km !== undefined) data.returnRatePerKm = req.body.return_rate_per_km != null ? Number(req.body.return_rate_per_km) : null
    if (req.body.hour_rate !== undefined)          data.hourRate        = req.body.hour_rate != null ? Number(req.body.hour_rate) : null
    if (req.body.km_per_day !== undefined)                data.kmPerDay              = req.body.km_per_day != null ? Number(req.body.km_per_day) : null
    if (req.body.driver_allowance_per_day !== undefined)  data.driverAllowancePerDay = req.body.driver_allowance_per_day != null ? Number(req.body.driver_allowance_per_day) : null
    if (req.body.city_id !== undefined) data.cityId = req.body.city_id != null ? Number(req.body.city_id) : null
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
      billing_mode?: 'commission' | 'package'
    } = {}
    if (req.body.name !== undefined)                    data.name = String(req.body.name)
    if (req.body.state !== undefined)                   data.state = String(req.body.state)
    if (req.body.default_speed_limit_kmph !== undefined) data.default_speed_limit_kmph = Number(req.body.default_speed_limit_kmph)
    if (req.body.status !== undefined)                  data.status = String(req.body.status)
    if (req.body.is_rental_enabled !== undefined)       data.is_rental_enabled = Boolean(req.body.is_rental_enabled)
    if (req.body.is_return_cab_enabled !== undefined)   data.is_return_cab_enabled = Boolean(req.body.is_return_cab_enabled)
    if (req.body.billing_mode !== undefined) data.billing_mode = String(req.body.billing_mode) as 'commission' | 'package'
    res.json(await service.updateAdminCity(BigInt(req.params['id']!), data))
  } catch (err) { next(err) }
}

// ─── Package tiers / driver package wallet ────────────────────────────────────

export async function getPackageTiers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.listPackageTiers()) } catch (err) { next(err) }
}

export async function postPackageTier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tier = await service.createPackageTier({
      label: String(req.body.label ?? ''),
      price: Number(req.body.price),
      thresholdValue: Number(req.body.thresholdValue),
      createdBy: req.admin!.id,
    })
    res.status(201).json(tier)
  } catch (err) { next(err) }
}

export async function patchPackageTier(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const data: { label?: string; price?: number; thresholdValue?: number; isActive?: boolean } = {}
    if (req.body.label !== undefined) data.label = String(req.body.label)
    if (req.body.price !== undefined) data.price = Number(req.body.price)
    if (req.body.thresholdValue !== undefined) data.thresholdValue = Number(req.body.thresholdValue)
    if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive)
    res.json(await service.updatePackageTier(BigInt(req.params['id']!), data))
  } catch (err) { next(err) }
}

export async function getDriverPackageDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { res.json(await service.getDriverPackageDetail(BigInt(req.params['id']!))) } catch (err) { next(err) }
}

export async function patchDriverPackageBalance(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const wallet = await service.adjustDriverPackageBalance(
      BigInt(req.params['id']!), Number(req.body.amount), String(req.body.reason ?? ''), req.admin!.id
    )
    res.json(wallet)
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

export async function getAdminDisputeTripReplay(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await disputeService.getTripReplay(BigInt(req.params['id']!)))
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
    const q: { status?: string; ride_type?: string; search?: string; cash_discrepancy?: boolean; page?: number; limit?: number } = {}
    if (req.query['status'])          q.status           = req.query['status'] as string
    if (req.query['ride_type'])       q.ride_type        = req.query['ride_type'] as string
    if (req.query['search'])          q.search           = req.query['search'] as string
    if (req.query['cashDiscrepancy']) q.cash_discrepancy = req.query['cashDiscrepancy'] === 'true'
    if (req.query['page'])            q.page             = parseInt(req.query['page'] as string, 10)
    if (req.query['limit'])           q.limit            = parseInt(req.query['limit'] as string, 10)
    res.json(await service.listAdminRides(q))
  } catch (err) { next(err) }
}

export async function getUpcomingScheduledRides(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ rides: await service.listUpcomingScheduledRides() })
  } catch (err) { next(err) }
}

export async function getAdminRideById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.getAdminRideById(BigInt(req.params['id']!)))
  } catch (err) { next(err) }
}

export async function forceResolveAdminRide(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { action, note } = req.body as { action: 'complete' | 'cancel'; note?: string }
    if (action !== 'complete' && action !== 'cancel') {
      res.status(400).json({ error: 'action must be complete or cancel', code: 'VALIDATION_ERROR' })
      return
    }
    const result = await service.forceResolveAdminRide(BigInt(req.params['id']!), action, req.admin!.id, note)
    res.json(result)
  } catch (err) { next(err) }
}

// ─── Admin Rental Packages ────────────────────────────────────────────────────

export async function getAdminRentalPackages(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await service.listAdminRentalPackages())
  } catch (err) { next(err) }
}

export async function patchAdminRentalPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { package_fare, extra_per_km, extra_per_min, is_active, duration_minutes, km_limit, display_order } = req.body as Record<string, unknown>
    const fields: {
      package_fare?: number; extra_per_km?: number; extra_per_min?: number; is_active?: boolean
      duration_minutes?: number; km_limit?: number; display_order?: number
    } = {}
    if (package_fare     !== undefined) fields.package_fare     = Number(package_fare)
    if (extra_per_km     !== undefined) fields.extra_per_km     = Number(extra_per_km)
    if (extra_per_min    !== undefined) fields.extra_per_min    = Number(extra_per_min)
    if (is_active        !== undefined) fields.is_active        = Boolean(is_active)
    if (duration_minutes !== undefined) fields.duration_minutes = Number(duration_minutes)
    if (km_limit         !== undefined) fields.km_limit         = Number(km_limit)
    if (display_order    !== undefined) fields.display_order    = Number(display_order)
    res.json(await service.updateAdminRentalPackage(BigInt(req.params['id']!), fields, req.admin!.id))
  } catch (err) { next(err) }
}

export async function deleteAdminRentalPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.deleteAdminRentalPackage(BigInt(req.params['id']!))
    res.status(204).end()
  } catch (err) { next(err) }
}

export async function postAdminRentalPackage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { category_id, duration_minutes, km_limit, package_fare, extra_per_km, extra_per_min, display_order } = req.body as Record<string, unknown>
    const pkg = await service.createAdminRentalPackage({
      category_id:      Number(category_id),
      duration_minutes: Number(duration_minutes),
      km_limit:         Number(km_limit),
      package_fare:     Number(package_fare),
      extra_per_km:     Number(extra_per_km),
      extra_per_min:    Number(extra_per_min),
      ...(display_order !== undefined ? { display_order: Number(display_order) } : {}),
    }, req.admin!.id)
    res.status(201).json(pkg)
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
