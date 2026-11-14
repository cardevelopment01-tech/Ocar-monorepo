import { describe, it, expect, vi } from 'vitest'
import { closeOcar } from './closeOcar'

describe('closeOcar', () => {
  it('stops location tracking first, then exits', async () => {
    const order: string[] = []
    await closeOcar({ stopTracking: async () => { order.push('stop') }, exitApp: () => { order.push('exit') } })
    expect(order).toEqual(['stop', 'exit'])
  })

  it('still exits when stopping tracking fails', async () => {
    const exitApp = vi.fn()
    await closeOcar({ stopTracking: () => Promise.reject(new Error('no task')), exitApp })
    expect(exitApp).toHaveBeenCalledTimes(1)
  })
})
