import { z } from 'zod'

export const createInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['super_admin', 'ops_admin', 'support_admin', 'finance_admin']),
})

export const redeemInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
})
