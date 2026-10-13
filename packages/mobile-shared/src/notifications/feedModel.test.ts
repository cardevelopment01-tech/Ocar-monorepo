import { describe, expect, it } from 'vitest'
import { bumpUnreadCount, getUnreadCount, isUrgentNotification, notificationGroup, notificationIcon, notificationTone, setUnreadCount, subscribeUnreadCount } from './feedModel'

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

describe('row look', () => {
  it('gives each type its own glyph and falls back to a bell for a new server type', () => {
    expect(notificationIcon('driver_arrived')).toBe('map-pin')
    expect(notificationIcon('offer')).toBe('gift')
    expect(notificationIcon('something_new')).toBe('bell')
  })

  it('tints by kind of news, with urgent winning over the group', () => {
    expect(notificationTone('ride_started')).toBe('ride')
    expect(notificationTone('ride_cancelled')).toBe('urgent')
    expect(notificationTone('wallet_low_balance')).toBe('money')
    expect(notificationTone('payment_failed')).toBe('urgent')
    expect(notificationTone('document_expiring')).toBe('account')
    expect(notificationTone('announcement')).toBe('promo')
    expect(notificationTone('something_new')).toBe('account')
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
