import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks must be declared before any import that triggers the module graph ──
vi.mock('@/modules/rides/rides.repository', () => ({
  getRideById: vi.fn(),
}))
vi.mock('@/modules/ride-chat/ride-chat.repository', () => ({
  insertMessageIdempotent: vi.fn(),
  listMessages: vi.fn(),
  markMessagesRead: vi.fn(),
  getUnreadMessageCount: vi.fn(),
}))
vi.mock('@/websocket/socket.server', () => ({
  socketEvents: { emitChatMessage: vi.fn(), emitChatRead: vi.fn() },
  getIO: vi.fn(() => ({ to: vi.fn(() => ({ emit: vi.fn() })) })),
  isChatOpen: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/modules/notifications/templates.service', () => ({
  renderTemplate: vi.fn().mockResolvedValue({ subject: 'New message', body: 'hi' }),
}))
vi.mock('@/modules/notifications/notifications.service', () => ({
  pushToTokens: vi.fn(),
}))
vi.mock('@/modules/notifications/notifications.repository', () => ({
  getTokensForOwner: vi.fn().mockResolvedValue(['token-1']),
}))

import * as ridesRepo from '@/modules/rides/rides.repository'
import * as chatRepo from '@/modules/ride-chat/ride-chat.repository'
import { socketEvents, isChatOpen } from '@/websocket/socket.server'
import { pushToTokens } from '@/modules/notifications/notifications.service'
import { getTokensForOwner } from '@/modules/notifications/notifications.repository'
import { sendMessage, getUnreadCount, getHistory } from '@/modules/ride-chat/ride-chat.service'

const RIDE = { id: 1n, user_id: '5', driver_id: '9', status: 'in_progress' }
const CLOSED_RIDE = { id: 1n, user_id: '5', driver_id: '9', status: 'completed' }
const NEW_ROW = {
  message: { id: '10', rideId: '1', senderType: 'user', senderId: '5', body: 'hi', clientMsgId: 'c1', readAt: null, createdAt: '2026-08-06T00:00:00.000Z' },
  inserted: true,
}

describe('sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(RIDE as never)
    vi.mocked(chatRepo.insertMessageIdempotent).mockResolvedValue(NEW_ROW as never)
    vi.mocked(getTokensForOwner).mockResolvedValue(['token-1'])
  })

  it('rejects a non-participant caller with AUTH_FORBIDDEN', async () => {
    await expect(
      sendMessage(1n, { userId: 999n }, { body: 'hi', clientMsgId: 'c1' }),
    ).rejects.toMatchObject({ httpStatus: 403, appCode: 'AUTH_FORBIDDEN' })
    expect(chatRepo.insertMessageIdempotent).not.toHaveBeenCalled()
  })

  it('on a NEW message, emits over the ride room and pushes the OTHER participant directly (bypassing the shared notification feed)', async () => {
    await sendMessage(1n, { userId: 5n }, { body: 'hi', clientMsgId: 'c1' })

    expect(socketEvents.emitChatMessage).toHaveBeenCalledWith('1', expect.objectContaining({ id: '10' }))
    // sender is the user (id 5) -> recipient is the driver (id 9)
    expect(getTokensForOwner).toHaveBeenCalledWith('driver', 9n)
    expect(pushToTokens).toHaveBeenCalledWith(['token-1'], expect.objectContaining({
      tag: 'chat:1',
      data: expect.objectContaining({ type: 'ride_chat_message', rideId: '1' }),
    }))
  })

  it('on an idempotent RETRY (inserted=false), does NOT emit and does NOT push', async () => {
    vi.mocked(chatRepo.insertMessageIdempotent).mockResolvedValue({ ...NEW_ROW, inserted: false } as never)

    const result = await sendMessage(1n, { userId: 5n }, { body: 'hi', clientMsgId: 'c1' })

    expect(result.id).toBe('10')
    expect(socketEvents.emitChatMessage).not.toHaveBeenCalled()
    expect(pushToTokens).not.toHaveBeenCalled()
  })

  it('still emits over the ride room but skips the push when the recipient already has the chat open', async () => {
    vi.mocked(isChatOpen).mockResolvedValueOnce(true)

    await sendMessage(1n, { userId: 5n }, { body: 'hi', clientMsgId: 'c1' })

    expect(isChatOpen).toHaveBeenCalledWith('driver', '9', '1')
    expect(socketEvents.emitChatMessage).toHaveBeenCalled()
    expect(pushToTokens).not.toHaveBeenCalled()
  })

  it('rejects sending on a ride that has ended', async () => {
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(CLOSED_RIDE as never)

    await expect(
      sendMessage(1n, { userId: 5n }, { body: 'hi', clientMsgId: 'c1' }),
    ).rejects.toMatchObject({ httpStatus: 422, appCode: 'RIDE_INVALID_STATUS' })
    expect(chatRepo.insertMessageIdempotent).not.toHaveBeenCalled()
  })
})

describe('getUnreadCount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(RIDE as never)
  })

  it('returns the unread count for the resolved participant', async () => {
    vi.mocked(chatRepo.getUnreadMessageCount).mockResolvedValue(3)

    const result = await getUnreadCount(1n, { userId: 5n })

    expect(result).toEqual({ count: 3 })
    // caller is the user -> reader type passed to the repo is 'user'
    expect(chatRepo.getUnreadMessageCount).toHaveBeenCalledWith(1n, 'user')
  })

  it('rejects a non-participant caller', async () => {
    await expect(getUnreadCount(1n, { userId: 999n })).rejects.toMatchObject({ httpStatus: 403 })
  })
})

describe('getHistory on a closed ride', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ridesRepo.getRideById).mockResolvedValue(CLOSED_RIDE as never)
  })

  it('still returns message history after the ride has ended', async () => {
    vi.mocked(chatRepo.listMessages).mockResolvedValue([])

    await expect(getHistory(1n, { userId: 5n }, undefined)).resolves.toEqual([])
    expect(chatRepo.listMessages).toHaveBeenCalledWith(1n, undefined)
  })
})
