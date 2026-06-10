import { Request, Response, NextFunction } from 'express'
import * as service from './users.service'

export async function getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const profile = await service.getProfile(req.user!.id)
    res.status(200).json({ user: profile })
  } catch (err) {
    next(err)
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as { full_name: string; email?: string }
    const updated = await service.updateProfile(req.user!.id, body)
    res.status(200).json({ user: updated })
  } catch (err) {
    next(err)
  }
}
