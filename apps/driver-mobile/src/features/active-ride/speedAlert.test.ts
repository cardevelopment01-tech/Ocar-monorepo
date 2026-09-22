import { describe, expect, it } from 'vitest'
import { classifyLimit, HIGHWAY_SPEED_LIMIT_KMPH, stepSpeedAlert, type SpeedAlertState } from './speedAlert'

const idle: SpeedAlertState = { overSince: null, lastAlertAt: 0 }
const CITY_LIMIT = 50
// A real epoch-scale base, like Date.now() -- lastAlertAt: 0 must read as
// "cooled" (never alerted), the way it does in production against a real
// clock. Starting the clock at 0 would instead make a fresh idle state look
// like it JUST alerted (now - 0 < COOLDOWN_MS), which is a test-harness
// artifact, not real behavior.
const T0 = 1_700_000_000_000

describe('stepSpeedAlert', () => {
  it('does not alert below limit + margin', () => {
    const { alert } = stepSpeedAlert(idle, 52, CITY_LIMIT, T0)
    expect(alert).toBe(false)
  })

  it('does not alert on a brief spike -- needs to sustain over the limit', () => {
    let state = idle
    ;({ state } = stepSpeedAlert(state, 60, CITY_LIMIT, T0))
    const result = stepSpeedAlert(state, 60, CITY_LIMIT, T0 + 2_000)
    expect(result.alert).toBe(false)
  })

  it('alerts once the driver holds over limit + margin for the sustain window', () => {
    let state = idle
    ;({ state } = stepSpeedAlert(state, 60, CITY_LIMIT, T0))
    const result = stepSpeedAlert(state, 60, CITY_LIMIT, T0 + 5_000)
    expect(result.alert).toBe(true)
  })

  it('stays quiet through the cooldown after alerting once', () => {
    let state = idle
    ;({ state } = stepSpeedAlert(state, 60, CITY_LIMIT, T0))
    ;({ state } = stepSpeedAlert(state, 60, CITY_LIMIT, T0 + 5_000))
    const result = stepSpeedAlert(state, 60, CITY_LIMIT, T0 + 10_000)
    expect(result.alert).toBe(false)
  })

  it('alerts again once the cooldown has fully elapsed', () => {
    let state = idle
    ;({ state } = stepSpeedAlert(state, 60, CITY_LIMIT, T0))
    ;({ state } = stepSpeedAlert(state, 60, CITY_LIMIT, T0 + 5_000))
    const result = stepSpeedAlert(state, 60, CITY_LIMIT, T0 + 5_000 + 45_000)
    expect(result.alert).toBe(true)
  })

  it('resets overSince once speed drops back under the trigger', () => {
    let state = idle
    ;({ state } = stepSpeedAlert(state, 60, CITY_LIMIT, T0))
    ;({ state } = stepSpeedAlert(state, 40, CITY_LIMIT, T0 + 2_000))
    expect(state.overSince).toBeNull()
  })
})

describe('classifyLimit', () => {
  const bhubaneswar = { centroid_lat: 20.2961, centroid_lng: 85.8245, default_speed_limit_kmph: 50 }

  it('uses the city limit inside the city radius', () => {
    expect(classifyLimit([20.2961, 85.8245], [bhubaneswar])).toBe(50)
  })

  it('falls back to the highway limit far from any city', () => {
    expect(classifyLimit([21.5, 86.9], [bhubaneswar])).toBe(HIGHWAY_SPEED_LIMIT_KMPH)
  })

  it('falls back to the highway limit with no cities loaded', () => {
    expect(classifyLimit([20.2961, 85.8245], [])).toBe(HIGHWAY_SPEED_LIMIT_KMPH)
  })
})
