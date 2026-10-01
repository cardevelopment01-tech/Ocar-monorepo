import { describe, expect, it } from 'vitest'
import { externalEndMessage } from './externalEnd'

describe('externalEndMessage', () => {
  it('flags a rider cancel (and a REST resync, which carries no cancelledBy)', () => {
    expect(externalEndMessage('cancelled', { cancelledBy: 'user' })).toBe('The rider cancelled this ride')
    expect(externalEndMessage('cancelled')).toBe('The rider cancelled this ride')
  })

  it('flags a system cancel distinctly', () => {
    expect(externalEndMessage('cancelled', { cancelledBy: 'system' })).toBe('This ride was cancelled')
  })

  it("ignores the driver's own cancel -- the cancel handler navigates itself", () => {
    expect(externalEndMessage('cancelled', { cancelledBy: 'driver' })).toBeNull()
  })

  it('flags force-resolved completions but not a normal completion', () => {
    expect(externalEndMessage('completed', { resolvedBy: 'timeout' })).toMatch(/inactivity/)
    expect(externalEndMessage('completed', { resolvedBy: 'admin' })).toMatch(/support/)
    expect(externalEndMessage('completed')).toBeNull()
  })

  it('flags a reverted force-assign', () => {
    expect(externalEndMessage('requested', { reason: 'force_assign_reverted' })).toMatch(/reassigned/)
    expect(externalEndMessage('requested')).toBeNull()
  })

  it('ignores ordinary in-flight statuses', () => {
    expect(externalEndMessage('in_progress')).toBeNull()
    expect(externalEndMessage('returning')).toBeNull()
  })
})
