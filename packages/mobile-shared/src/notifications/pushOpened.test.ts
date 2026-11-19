import { describe, expect, it, vi } from 'vitest'
import { markPushOpened } from './pushOpened'

// Value: protects=a tap on a broadcast marks that person's notification read, which is how the admin's "Opened" count fills in;
// fails_when=the id is dropped, a failed call breaks the tap, or an id from a push payload is put into the URL unchecked;
// why_new=riders have no notification list, so a tap was the only place "opened" could ever be recorded; seam=the API client is replaced.
describe('markPushOpened', () => {
  it('marks the notification read using the id the push carried', async () => {
    const api = { patch: vi.fn().mockResolvedValue({}) }
    expect(await markPushOpened(api, { type: 'offer', notificationId: '4812' })).toBe(true)
    expect(api.patch).toHaveBeenCalledWith('/api/v1/notifications/4812/read')
  })

  it('does nothing for a push with no id (older pushes, chat messages)', async () => {
    const api = { patch: vi.fn() }
    expect(await markPushOpened(api, { type: 'ride_chat_message' })).toBe(false)
    expect(await markPushOpened(api, undefined)).toBe(false)
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('never puts anything but a number into the URL', async () => {
    const api = { patch: vi.fn() }
    for (const id of ['../admin', '12/../../x', '1;2', '', 'abc', '1'.repeat(25)]) {
      expect(await markPushOpened(api, { notificationId: id })).toBe(false)
    }
    expect(api.patch).not.toHaveBeenCalled()
  })

  it('a failed call (offline, already read) does not throw', async () => {
    const api = { patch: vi.fn().mockRejectedValue(new Error('offline')) }
    await expect(markPushOpened(api, { notificationId: '9' })).resolves.toBe(true)
  })
})
