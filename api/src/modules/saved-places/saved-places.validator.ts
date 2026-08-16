import { z } from 'zod'

export const createSchema = z
  .object({
    kind: z.enum(['home', 'work', 'other']),
    label: z.string().trim().min(1).max(60).optional(),
    address: z.string().trim().min(1).max(300),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .refine(d => d.kind !== 'other' || !!d.label, {
    message: 'label is required for a custom place',
    path: ['label'],
  })

export const updateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  address: z.string().trim().min(1).max(300),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})
