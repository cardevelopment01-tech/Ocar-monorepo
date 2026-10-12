import { describe, it, expect } from 'vitest'
import { decideSessionSync } from './sessionReconcile'

describe('decideSessionSync', () => {
  it('server ended the session but the app still shows Online -> go offline (the bug)', () => {
    expect(decideSessionSync({ isOnline: true, sessionId: '738' }, null)).toBe('go_offline')
  })

  it('both agree the driver is offline -> nothing to do', () => {
    expect(decideSessionSync({ isOnline: false, sessionId: null }, null)).toBe('none')
  })

  it('server has a live session the app does not know about -> go online', () => {
    expect(decideSessionSync({ isOnline: false, sessionId: null }, { id: '740' })).toBe('go_online')
  })

  it('same session on both sides -> nothing to do', () => {
    expect(decideSessionSync({ isOnline: true, sessionId: '740' }, { id: '740' })).toBe('none')
  })

  it('app is pointing at an older session than the server has -> adopt the server session', () => {
    expect(decideSessionSync({ isOnline: true, sessionId: '738' }, { id: '742' })).toBe('go_online')
  })
})
