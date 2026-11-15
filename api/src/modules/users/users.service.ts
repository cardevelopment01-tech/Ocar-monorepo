import * as repo from './users.repository'
import { resolvePersonName } from '@/lib/person-name'
import { findUserById } from '@/modules/auth/auth.repository'

export async function getProfile(id: bigint) {
  return repo.findWithStats(id)
}

export async function updateProfile(
  id: bigint,
  data: { full_name: string; email?: string | null }
) {
  const name = await resolvePersonName(data.full_name, { min: 2, max: 120 }, async () => (await findUserById(id))?.name)
  const input: { name: string; email?: string | null } = { name }
  if (data.email !== undefined) input.email = data.email
  return repo.updateProfile(id, input)
}
