import { z } from 'zod'
import { ADMIN_PASSWORD_MAX_LENGTH, ADMIN_PASSWORD_MIN_LENGTH } from '@/lib/password-policy'

export const createInviteSchema = z.object({
  // Checked after trimming, so a padded address is accepted; the service does the actual trimming and lower-casing (validate() discards the parsed copy).
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(['super_admin', 'ops_admin', 'support_admin', 'finance_admin']),
})

export const redeemInviteSchema = z.object({
  token: z.string().min(1),
  // Length, not character-mix rules (NIST 800-63B-4). The login schema keeps its own looser floor: existing admins must still sign in.
  password: z.string().min(ADMIN_PASSWORD_MIN_LENGTH).max(ADMIN_PASSWORD_MAX_LENGTH),
})
