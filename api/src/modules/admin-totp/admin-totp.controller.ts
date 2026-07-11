import { Request, Response, NextFunction } from 'express'
import * as service from './admin-totp.service'

export async function getStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = await service.getStatus(req.admin!.id)
    res.json(status)
  } catch (err) {
    next(err)
  }
}

export async function startSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await service.startSetup(req.admin!.id)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function confirmSetup(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.body as { code: string }
    const result = await service.confirmSetup(req.admin!.id, code, req.ip ?? null)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

export async function disableTotp(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { password } = req.body as { password: string }
    await service.disableTotp(req.admin!.id, password, req.ip ?? null)
    res.json({ success: true })
  } catch (err) {
    next(err)
  }
}
