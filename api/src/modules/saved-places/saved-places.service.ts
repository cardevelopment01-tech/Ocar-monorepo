import { createHttpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as repo from './saved-places.repository'
import type { SavedPlaceKind } from './saved-places.repository'

export async function listPlaces(userId: bigint) {
  return repo.list(userId)
}

export async function createPlace(
  userId: bigint,
  data: { kind: SavedPlaceKind; label?: string; address: string; latitude: number; longitude: number }
) {
  // Home/Work carry a fixed label regardless of client input; only 'other' uses the user's own text.
  const label = data.kind === 'other' ? data.label! : data.kind === 'home' ? 'Home' : 'Work'
  return repo.create(userId, { kind: data.kind, label, address: data.address, latitude: data.latitude, longitude: data.longitude })
}

export async function updatePlace(
  userId: bigint,
  id: bigint,
  data: { label?: string; address: string; latitude: number; longitude: number }
) {
  const existing = await repo.list(userId)
  const current = existing.find(p => p.id === id.toString())
  if (!current) throw createHttpError(AppErrors.NOT_FOUND)

  // Home/Work labels are fixed — reject an attempt to change them rather than
  // silently accepting and discarding the client's value.
  if (current.kind !== 'other' && data.label !== undefined) {
    throw createHttpError(AppErrors.VALIDATION_ERROR)
  }

  const label = current.kind === 'other' ? (data.label ?? current.label) : current.label
  const updated = await repo.update(userId, id, { label, address: data.address, latitude: data.latitude, longitude: data.longitude })
  if (!updated) throw createHttpError(AppErrors.NOT_FOUND)
  return updated
}

export async function removePlace(userId: bigint, id: bigint) {
  const removed = await repo.remove(userId, id)
  if (!removed) throw createHttpError(AppErrors.NOT_FOUND)
}
