import { Request, Response, NextFunction } from 'express'
import * as service from './admin.service'
import type { DriverStatus } from './admin.types'

export async function getDrivers(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.listDrivers({
      status:  req.query['status']  as string | undefined,
      search:  req.query['search']  as string | undefined,
      page:    req.query['page']    ? parseInt(req.query['page']  as string, 10) : undefined,
      limit:   req.query['limit']   ? parseInt(req.query['limit'] as string, 10) : undefined,
    })
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

    // Fetch current status first
    const driver = await service.getDriver(driverId)

    await service.updateDriverStatus(driverId, adminId, driver.status as DriverStatus, {
      status: req.body.status as DriverStatus,
      reason: req.body.reason as string | undefined,
    })

    res.json({ success: true, status: req.body.status })
  } catch (err) {
    next(err)
  }
}
