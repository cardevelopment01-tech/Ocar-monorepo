import { pool } from '@/db/client'
import type { RideMessageDTO, RideParticipantType, SendMessageInput } from './ride-chat.types'

interface RideMessageRow {
  id: string
  ride_id: string
  sender_type: RideParticipantType
  sender_id: string
  body: string
  client_msg_id: string
  read_at: string | null
  created_at: string
}

const SELECT_COLS = `
  id::text            AS id,
  ride_id::text       AS ride_id,
  sender_type,
  sender_id::text     AS sender_id,
  body,
  client_msg_id::text AS client_msg_id,
  read_at,
  created_at`

function toDTO(r: RideMessageRow): RideMessageDTO {
  return {
    id: r.id,
    rideId: r.ride_id,
    senderType: r.sender_type,
    senderId: r.sender_id,
    body: r.body,
    clientMsgId: r.client_msg_id,
    readAt: r.read_at === null ? null : new Date(r.read_at).toISOString(),
    createdAt: new Date(r.created_at).toISOString(),
  }
}

// Idempotent insert. On a duplicate (ride_id, sender_type, sender_id, client_msg_id)
// the ON CONFLICT DO NOTHING returns zero rows, so we SELECT the pre-existing row
// by the same key and return it with inserted=false. Callers use `inserted` to
// decide whether to emit/notify (never re-notify on a retry).
export async function insertMessageIdempotent(
  input: SendMessageInput,
): Promise<{ message: RideMessageDTO; inserted: boolean }> {
  const ins = await pool.query<RideMessageRow>(
    `INSERT INTO ride_messages (ride_id, sender_type, sender_id, body, client_msg_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ride_id, sender_type, sender_id, client_msg_id) DO NOTHING
     RETURNING ${SELECT_COLS}`,
    [input.rideId, input.senderType, input.senderId, input.body, input.clientMsgId],
  )
  if (ins.rows[0]) return { message: toDTO(ins.rows[0]), inserted: true }

  const sel = await pool.query<RideMessageRow>(
    `SELECT ${SELECT_COLS} FROM ride_messages
     WHERE ride_id = $1 AND sender_type = $2 AND sender_id = $3 AND client_msg_id = $4`,
    [input.rideId, input.senderType, input.senderId, input.clientMsgId],
  )
  return { message: toDTO(sel.rows[0]!), inserted: false }
}

// after: return only messages with id strictly greater than this cursor (null = all).
export async function listMessages(rideId: bigint, after: bigint | undefined): Promise<RideMessageDTO[]> {
  const res = await pool.query<RideMessageRow>(
    `SELECT ${SELECT_COLS} FROM ride_messages
     WHERE ride_id = $1 AND ($2::bigint IS NULL OR id > $2)
     ORDER BY id ASC`,
    [rideId, after ?? null],
  )
  return res.rows.map(toDTO)
}

// readerType marks messages from the OTHER participant (sender_type <> reader) as read.
export async function markMessagesRead(rideId: bigint, readerType: RideParticipantType): Promise<number> {
  const res = await pool.query(
    `UPDATE ride_messages SET read_at = now()
     WHERE ride_id = $1 AND sender_type <> $2 AND read_at IS NULL`,
    [rideId, readerType],
  )
  return res.rowCount ?? 0
}
