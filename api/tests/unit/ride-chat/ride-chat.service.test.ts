import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks must be declared before any import that triggers the module graph ──
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById: vi.fn(),
}))
vi.mock('@/modules/ride-chat/ride-chat.repository', () => ({
  insertMessageIdempotent: vi.fn(),
  listMessages: vi.fn(),
  markMessagesRead: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { emitChatMessage: vi.fn(), emitChatRead: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
}))
vi.mock('@/modules/notifications/templates.service', () => ({
  renderTemplate: vi.fn().mockResolvedValue({ subject: 'New message', body: 'hi' }),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(),
}))

import * as ridesRepo from '@/modules/rides/rides.repository'
import * as chatRepo from '@/modules/ride-chat/ride-chat.repository'
import { socketEvents } from '@/websocket/socket.server'
import { notifyOwner } from '@/modules/notifications/notifications.service'
import { sendMessage } from '@/modules/ride-chat/ride-chat.service'

const RIDE = { id: 1n, user_id: '5', driver_id: '9', status: 'in_progress' }
const NEW_ROW = {
  message: { id: '10', rideId: '1', senderType: 'user', senderId: '5', body: 'hi', clientMsgId: 'c1', readAt: null, createdAt: '2026-08-06T00:00:00.000Z' },
  inserted: true,
}

describe('sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(RIDE as never)
    vi.mocked(chatRepo.insertMessageIdempotent).mockResolvedValue(NEW_ROW as never)
  })

  it('rejects a non-participant caller with AUTH_FORBIDDEN', async () => {
    await expect(
      sendMessage(1n, { userId: 999n }, { body: 'hi', clientMsgId: 'c1' }),
    ).rejects.toMatchObject({ httpStatus: 403, appCode: 'AUTH_FORBIDDEN' })
    expect(chatRepo.insertMessageIdempotent).not.toHaveBeenCalled()
  })

  it('on a NEW message, emits over the ride room and notifies the OTHER participant with the ride_chat_message template', async () => {
    await sendMessage(1n, { userId: 5n }, { body: 'hi', clientMsgId: 'c1' })

    expect(socketEvents.emitChatMessage).toHaveBeenCalledWith('1', expect.objectContaining({ id: '10' }))
    // sender is the user (id 5) -> recipient is the driver (id 9)
    expect(notifyOwner).toHaveBeenCalledWith(expect.objectContaining({
      ownerType: 'driver',
      ownerId: 9n,
      type: 'ride_chat_message',
      rideId: 1n,
    }))
  })

  it('on an idempotent RETRY (inserted=false), does NOT emit and does NOT notify', async () => {
    vi.mocked(chatRepo.insertMessageIdempotent).mockResolvedValue({ ...NEW_ROW, inserted: false } as never)

    const result = await sendMessage(1n, { userId: 5n }, { body: 'hi', clientMsgId: 'c1' })

    expect(result.id).toBe('10')
    expect(socketEvents.emitChatMessage).not.toHaveBeenCalled()
    expect(notifyOwner).not.toHaveBeenCalled()
  })
})
