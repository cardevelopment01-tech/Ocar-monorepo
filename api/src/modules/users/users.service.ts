import * as repo from './users.repository'
import { requirePersonName } from '@/lib/person-name'

export async function getProfile(id: bigint) {
  return repo.findWithStats(id)
}

export async function updateProfile(
  id: bigint,
  data: { full_name: string; email?: string | null }
) {
  const input: { name: string; email?: string | null } = { name: requirePersonName(data.full_name, { min: 2, max: 120 }) }
  if (data.email !== undefined) input.email = data.email
  return repo.updateProfile(id, input)
}
