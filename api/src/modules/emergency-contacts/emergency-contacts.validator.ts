import { z } from 'zod'

export const createSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(60),
  phone: z.string().regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile number (+91XXXXXXXXXX)'),
})
