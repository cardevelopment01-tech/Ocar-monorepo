import { Request, Response, NextFunction } from 'express'
import * as service from './admin-invites.service'
import type { AdminRole } from '@/constants/enums'

export async function createInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, role } = req.body as { email: string; role: AdminRole }
    const invite = await service.createInvite({ email, role, invitedBy: req.admin!.id })
    res.status(201).json({ invite })
  } catch (err) {
    next(err)
  }
}

export async function listInvites(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invites = await service.listInvites()
    res.status(200).json({ invites })
  } catch (err) {
    next(err)
  }
}

export async function revokeInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invite = await service.revokeInvite(BigInt(req.params['id']!))
    res.status(200).json({ invite })
  } catch (err) {
    next(err)
  }
}

// Public — the invitee has no admin session yet. Gated entirely by the
// invite token itself, not by authenticate()/requireAdmin.
export async function redeemInvite(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, password } = req.body as { token: string; password: string }
    const admin = await service.redeemInvite(token, password)
    res.status(201).json({ admin })
  } catch (err) {
    next(err)
  }
}
