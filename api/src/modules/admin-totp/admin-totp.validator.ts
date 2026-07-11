import { z } from 'zod'

export const confirmSetupSchema = z.object({
  code: z.string().length(6).regex(/^\d{6}$/, 'Code must be 6 digits'),
})

export const disableTotpSchema = z.object({
  password: z.string().min(1),
})
