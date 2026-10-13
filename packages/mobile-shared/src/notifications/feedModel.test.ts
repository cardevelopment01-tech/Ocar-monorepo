import { describe, expect, it } from 'vitest'
import { bumpUnreadCount, getUnreadCount, isUrgentNotification, notificationGroup, setUnreadCount, subscribeUnreadCount } from './feedModel'

describe('notificationGroup', () => {
  it('groups ride lifecycle, payment and account types', () => {
    expect(notificationGroup('driver_arrived')).toBe('rides')
    expect(notificationGroup('stop_added')).toBe('rides')
    expect(notificationGroup('payment_failed')).toBe('payments')
    expect(notificationGroup('wallet_low_balance')).toBe('payments')
    expect(notificationGroup('document_rejected')).toBe('account')
  })

  it('puts unknown types in "other" so a new server type still renders', () => {
    expect(notificationGroup('something_new')).toBe('other')
  })

  it('flags only things the user probably has to act on as urgent', () => {
    expect(isUrgentNotification('document_rejected')).toBe(true)
    expect(isUrgentNotification('ride_cancelled')).toBe(true)
    expect(isUrgentNotification('ride_started')).toBe(false)
  })
})

describe('unread count', () => {
  it('never goes below zero', () => {
    setUnreadCount(1)
    bumpUnreadCount(-5)
    expect(getUnreadCount()).toBe(0)
  })

  it('tells subscribers only when the value actually changes', () => {
    setUnreadCount(0)
    let calls = 0
    const off = subscribeUnreadCount(() => { calls += 1 })
    setUnreadCount(0)
    bumpUnreadCount(2)
    off()
    bumpUnreadCount(1)
    expect(calls).toBe(1)
    expect(getUnreadCount()).toBe(3)
  })
})
