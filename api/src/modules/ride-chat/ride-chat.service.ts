import { getRideById } from '@/modules/rides/rides.repository'
import { renderTemplate } from '@/modules/notifications/templates.service'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { socketEvents } from '@/websocket/socket.server'
import { createHttpError } from '@/lib/errors'
import { AppErrors } from '@/constants/errors'
import * as repo from './ride-chat.repository'
import type { ChatCaller, RideMessageDTO, RideParticipantType } from './ride-chat.types'

interface ResolvedParticipant {
  senderType: RideParticipantType
  senderId: bigint
  recipientType: RideParticipantType
  recipientId: bigint | null
}

// Reuses rides.repository.getRideById + the same String(...) === comparison the
// rides.routes.ts GET /:id handler and the join:ride socket handler already use.
// Returns who the caller is (sender) and who the other party is (recipient).
async function resolveParticipant(rideId: bigint, caller: ChatCaller): Promise<ResolvedParticipant> {
  const ride = await getRideById(rideId)
  if (!ride) throw createHttpError(AppErrors.RIDE_NOT_FOUND)

  if (caller.userId !== undefined && String(ride.user_id) === String(caller.userId)) {
    return {
      senderType: 'user', senderId: caller.userId,
      recipientType: 'driver', recipientId: ride.driver_id === null ? null : BigInt(ride.driver_id),
    }
  }
  if (caller.driverId !== undefined && ride.driver_id !== null && String(ride.driver_id) === String(caller.driverId)) {
    return {
      senderType: 'driver', senderId: caller.driverId,
      recipientType: 'user', recipientId: BigInt(ride.user_id),
    }
  }
  throw createHttpError(AppErrors.AUTH_FORBIDDEN)
}

export async function sendMessage(
  rideId: bigint,
  caller: ChatCaller,
  input: { body: string; clientMsgId: string },
): Promise<RideMessageDTO> {
  const p = await resolveParticipant(rideId, caller)

  const { message, inserted } = await repo.insertMessageIdempotent({
    rideId, senderType: p.senderType, senderId: p.senderId,
    body: input.body, clientMsgId: input.clientMsgId,
  })

  // Only fan out for a genuinely new message. A retry (same clientMsgId) returns
  // the original row with no side effects, so the recipient is never double-notified.
  if (inserted) {
    socketEvents.emitChatMessage(String(rideId), message)
    if (p.recipientId !== null) {
      const preview = input.body.length > 80 ? input.body.slice(0, 77) + '…' : input.body
      const { subject, body } = await renderTemplate('ride_chat_message', 'push', { preview })
      await notifyOwner({
        ownerType: p.recipientType,
        ownerId: p.recipientId,
        type: 'ride_chat_message',
        title: subject ?? 'New message',
        body,
        rideId,
        payload: { rideId: String(rideId), messageId: message.id },
      })
    }
  }
  return message
}

export async function getHistory(
  rideId: bigint,
  caller: ChatCaller,
  after: bigint | undefined,
): Promise<RideMessageDTO[]> {
  await resolveParticipant(rideId, caller)
  return repo.listMessages(rideId, after)
}

export async function markRead(rideId: bigint, caller: ChatCaller): Promise<{ count: number }> {
  const p = await resolveParticipant(rideId, caller)
  const count = await repo.markMessagesRead(rideId, p.senderType)
  if (count > 0) socketEvents.emitChatRead(String(rideId), { readerType: p.senderType })
  return { count }
}
