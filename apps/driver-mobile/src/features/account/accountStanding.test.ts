import { describe, it, expect } from 'vitest'
import { restrictionFromErrorCode, restrictionOf, standingRoute, STATUS_SCREEN } from './accountStanding'

const ride = { id: '12', status: 'in_progress' } as const

describe('standingRoute', () => {
  it('sends a banned driver to the status screen, even with a ride on record', () => {
    expect(standingRoute('banned', null)).toBe(STATUS_SCREEN)
    expect(standingRoute('banned', ride)).toBe(STATUS_SCREEN)
  })
  it('sends a suspended driver to the status screen unless they are mid-trip', () => {
    expect(standingRoute('suspended', null)).toBe(STATUS_SCREEN)
    expect(standingRoute('suspended', ride)).toBe('/active-ride/12')
  })
  it('leaves everyone else on the normal launch routing', () => {
    expect(standingRoute('active', null)).toBe('/(tabs)/home')
    expect(standingRoute('active', ride)).toBe('/active-ride/12')
    expect(standingRoute(undefined, null)).toBe('/(tabs)/home')
  })
})

describe('restrictions', () => {
  it('recognises only the two restricted statuses', () => {
    expect(restrictionOf('suspended')).toBe('suspended')
    expect(restrictionOf('banned')).toBe('banned')
    expect(restrictionOf('active')).toBeNull()
    expect(restrictionOf('docs_rejected')).toBeNull()
  })
  it('maps the API error codes', () => {
    expect(restrictionFromErrorCode('DRIVER_BANNED')).toBe('banned')
    expect(restrictionFromErrorCode('DRIVER_SUSPENDED')).toBe('suspended')
    expect(restrictionFromErrorCode('LOW_WALLET_BALANCE')).toBeNull()
    expect(restrictionFromErrorCode(undefined)).toBeNull()
  })
})
