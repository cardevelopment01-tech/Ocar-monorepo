import { query } from '@/db/client'

export type SavedPlaceKind = 'home' | 'work' | 'other'

export interface SavedPlaceDTO {
  id: string
  kind: SavedPlaceKind
  label: string
  address: string
  latitude: number
  longitude: number
}

interface SavedPlaceRow {
  id: string
  kind: SavedPlaceKind
  label: string
  address: string
  latitude: string
  longitude: string
}

function toDTO(row: SavedPlaceRow): SavedPlaceDTO {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    address: row.address,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }
}

const COLUMNS = 'id, kind, label, address, latitude, longitude'

export async function list(userId: bigint): Promise<SavedPlaceDTO[]> {
  const rows = await query<SavedPlaceRow>(
    `SELECT ${COLUMNS} FROM saved_places WHERE user_id = $1
     ORDER BY CASE kind WHEN 'home' THEN 0 WHEN 'work' THEN 1 ELSE 2 END, created_at`,
    [userId.toString()]
  )
  return rows.map(toDTO)
}

export async function create(
  userId: bigint,
  data: { kind: SavedPlaceKind; label: string; address: string; latitude: number; longitude: number }
): Promise<SavedPlaceDTO> {
  const rows = await query<SavedPlaceRow>(
    `INSERT INTO saved_places (user_id, kind, label, address, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${COLUMNS}`,
    [userId.toString(), data.kind, data.label, data.address, data.latitude, data.longitude]
  )
  return toDTO(rows[0]!)
}

export async function update(
  userId: bigint,
  id: bigint,
  data: { label: string; address: string; latitude: number; longitude: number }
): Promise<SavedPlaceDTO | null> {
  const rows = await query<SavedPlaceRow>(
    `UPDATE saved_places SET label = $3, address = $4, latitude = $5, longitude = $6
     WHERE id = $1 AND user_id = $2
     RETURNING ${COLUMNS}`,
    [id.toString(), userId.toString(), data.label, data.address, data.latitude, data.longitude]
  )
  return rows[0] ? toDTO(rows[0]) : null
}

export async function remove(userId: bigint, id: bigint): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM saved_places WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id.toString(), userId.toString()]
  )
  return rows.length > 0
}
