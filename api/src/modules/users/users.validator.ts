import { z } from 'zod'
import { personNameSchema } from '@/lib/person-name'

export const updateProfileSchema = z.object({
  full_name: personNameSchema({ min: 2, max: 120 }),
  email: z.string().email('Invalid email address').nullable().optional(),
})
