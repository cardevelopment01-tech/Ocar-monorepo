import { z } from 'zod'
import { personNameSchema } from '@/lib/person-name'

export const createSchema = z.object({
  name: personNameSchema({ min: 1, max: 60 }),
  phone: z.string().regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile number (+91XXXXXXXXXX)'),
})
