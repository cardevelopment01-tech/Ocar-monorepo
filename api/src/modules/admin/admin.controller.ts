import { Request, Response, NextFunction } from 'express'
import * as service from './admin.service'
import type { DriverStatus } from './admin.types'

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
