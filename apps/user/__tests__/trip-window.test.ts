import { describe, expect, it } from 'vitest'
import cases from '../../../packages/mobile-shared/src/utils/tripWindow.cases.json'
import { tripWindow } from '../lib/tripWindow'

// The same boundary table runs in packages/mobile-shared and apps/driver, so every client crosses each boundary
// at the same instant. If this fails, re-copy packages/mobile-shared/src/utils/tripWindow.ts over lib/tripWindow.ts.
describe('tripWindow boundary table', () => {
  const base = new Date(cases.bookedUntil).getTime()
  it.each(cases.inputs)('$name', (c) => {
    expect(tripWindow({
      bookedUntil: 'bookedUntil' in c ? c.bookedUntil : cases.bookedUntil,
      graceMin: 'graceMin' in c ? c.graceMin : cases.graceMin,
      overtimeRate: 'overtimeRate' in c ? c.overtimeRate : cases.overtimeRate,
      now: base + c.nowOffsetMs,
    })).toEqual(c.expect)
  })
})
