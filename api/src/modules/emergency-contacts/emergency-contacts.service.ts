import { query } from '@/db/client'
import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as repo from './emergency-contacts.repository'

export const MAX_CONTACTS = 3

export const listContacts = repo.list

export async function addContact(userId: bigint, name: string, phone: string) {
  const existing = await repo.list(userId)
  if (existing.length >= MAX_CONTACTS) {
    throw httpError(422, `You can add up to ${MAX_CONTACTS} emergency contacts`, 'EMERGENCY_CONTACT_LIMIT')
  }
  if (existing.some((c) => c.phone === phone)) {
    throw httpError(409, 'This number is already one of your emergency contacts', 'EMERGENCY_CONTACT_DUPLICATE')
  }
  const own = await query<{ phone: string }>('SELECT phone FROM users WHERE id = $1', [userId.toString()])
  if (own[0]?.phone === phone) {
    throw httpError(422, 'Emergency contact cannot be your own number', 'VALIDATION_ERROR')
  }
  return repo.insert(userId, name, phone)
}

export async function removeContact(userId: bigint, id: bigint) {
  if (!(await repo.remove(userId, id))) throw createHttpError(AppErrors.NOT_FOUND)
}
