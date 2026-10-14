import { createHttpError, httpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as repo from './emergency-contacts.repository'

export const MAX_CONTACTS = 3

export const listContacts = repo.list

export async function addContact(userId: bigint, name: string, phone: string) {
  const r = await repo.insertWithinLimit(userId, name, phone, MAX_CONTACTS)
  if (r.result === 'added') return r.contact
  if (r.result === 'limit') throw httpError(422, `You can add up to ${MAX_CONTACTS} emergency contacts`, 'EMERGENCY_CONTACT_LIMIT')
  if (r.result === 'duplicate') throw httpError(409, 'This number is already one of your emergency contacts', 'EMERGENCY_CONTACT_DUPLICATE')
  throw httpError(422, 'Emergency contact cannot be your own number', 'VALIDATION_ERROR')
}

export async function removeContact(userId: bigint, id: bigint) {
  if (!(await repo.remove(userId, id))) throw createHttpError(AppErrors.NOT_FOUND)
}
