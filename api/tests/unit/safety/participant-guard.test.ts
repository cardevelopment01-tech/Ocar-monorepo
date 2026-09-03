import { describe, it, expect } from 'vitest'
import { assertRideParticipant } from '@/modules/safety/safety.guards'

describe('assertRideParticipant', () => {
  const ride = { user_id: 7n, driver_id: 42n }

  it('allows the ride rider', () => {
    expect(() => assertRideParticipant(ride, { role: 'user', id: 7n })).not.toThrow()
  })

  it('allows the ride driver', () => {
    expect(() => assertRideParticipant(ride, { role: 'driver', id: 42n })).not.toThrow()
  })

  it('rejects a different user with 403 NOT_RIDE_PARTICIPANT', () => {
    expect(() => assertRideParticipant(ride, { role: 'user', id: 8n }))
      .toThrowError(expect.objectContaining({ httpStatus: 403, appCode: 'NOT_RIDE_PARTICIPANT' }))
  })

  it('rejects a different driver with 403', () => {
    expect(() => assertRideParticipant(ride, { role: 'driver', id: 99n }))
      .toThrowError(expect.objectContaining({ httpStatus: 403, appCode: 'NOT_RIDE_PARTICIPANT' }))
  })

  it('rejects when the ride has no driver assigned and a driver claims it', () => {
    expect(() => assertRideParticipant({ user_id: 7n, driver_id: null }, { role: 'driver', id: 42n }))
      .toThrowError(expect.objectContaining({ httpStatus: 403 }))
  })

  it('coerces string/number ride ids (pg column shape) before comparing', () => {
    expect(() => assertRideParticipant({ user_id: '7', driver_id: 42 }, { role: 'user', id: 7n })).not.toThrow()
  })
})
