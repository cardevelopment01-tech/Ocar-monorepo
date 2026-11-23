import { Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import type { AdminRole } from '@/constants/enums'
import * as service from './admin-lifecycle.service'

// Every risky action asks for the acting admin's own password again. The target id comes from the path; nothing else about who is acting is
// taken from the request.
const password = z.string().min(1).max(200)
export const changeRoleSchema = z.object({ role: z.enum(['super_admin', 'ops_admin', 'support_admin', 'finance_admin']), password }).strict()
export const removeAdminSchema = z.object({ password, confirmEmail: z.string().min(3).max(320) }).strict()
export const stepUpSchema = z.object({ password }).strict()

const acting = (req: Request) => ({ actingAdminId: req.admin!.id, ipAddress: req.ip ?? null })
const target = (req: Request) => BigInt(req.params['id']!)

export async function patchRole(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { role, password: pw } = req.body as { role: AdminRole; password: string }
    res.json({ admin: await service.changeRole({ ...acting(req), targetId: target(req), role, password: pw }) })
  } catch (err) { next(err) }
}

export async function deleteAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { password: pw, confirmEmail } = req.body as { password: string; confirmEmail: string }
    await service.removeAdmin({ ...acting(req), targetId: target(req), password: pw, confirmEmail })
    res.status(204).end()
  } catch (err) { next(err) }
}

export async function postResetTwoFactor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ admin: await service.resetTwoFactor({ ...acting(req), targetId: target(req), password: (req.body as { password: string }).password }) })
  } catch (err) { next(err) }
}

export async function postSignOut(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await service.signOutAdmin({ ...acting(req), targetId: target(req), password: (req.body as { password: string }).password })
    res.status(204).end()
  } catch (err) { next(err) }
}
