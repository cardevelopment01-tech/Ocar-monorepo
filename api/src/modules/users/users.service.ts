import * as repo from './users.repository'

export async function getProfile(id: bigint) {
  return repo.findWithStats(id)
}

export async function updateProfile(
  id: bigint,
  data: { full_name: string; email?: string }
) {
  const input: { name: string; email?: string } = { name: data.full_name }
  if (data.email !== undefined) input.email = data.email
  return repo.updateProfile(id, input)
}
