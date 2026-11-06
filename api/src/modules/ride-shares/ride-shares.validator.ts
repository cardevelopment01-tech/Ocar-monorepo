import { z } from 'zod'

// Contacts are the rider's saved emergency contacts (at most 3). No contacts named = one anonymous link for the phone's share sheet.
export const createSchema = z.object({
  contactIds: z.array(z.string().regex(/^\d{1,18}$/, 'Invalid contact id')).max(3).optional(),
})

// A share token is 22 base64url characters today; accept a little range so a longer token later still reaches the lookup.
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/
