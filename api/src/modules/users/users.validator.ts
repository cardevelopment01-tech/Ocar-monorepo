import { z } from 'zod'

export const updateProfileSchema = z.object({
  full_name: z.string().min(2, 'Name must be at least 2 characters').max(120).trim(),
  email: z.string().email('Invalid email address').optional(),
})
