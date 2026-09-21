import { describe, expect, it } from 'vitest'
import { statusKind } from './statusKind'

describe('statusKind', () => {
  it('maps completed to success', () => {
    expect(statusKind('completed')).toBe('success')
  })

  it('maps cancelled and no_drivers to error', () => {
    expect(statusKind('cancelled')).toBe('error')
    expect(statusKind('no_drivers')).toBe('error')
  })

  it('maps scheduled to info', () => {
    expect(statusKind('scheduled')).toBe('info')
  })

  it('maps every in-flight status to warning', () => {
    expect(statusKind('requested')).toBe('warning')
    expect(statusKind('accepted')).toBe('warning')
    expect(statusKind('driver_arrived')).toBe('warning')
    expect(statusKind('in_progress')).toBe('warning')
  })

  it('falls back to warning for an unrecognized status instead of throwing', () => {
    expect(statusKind('some_future_status')).toBe('warning')
  })
})
