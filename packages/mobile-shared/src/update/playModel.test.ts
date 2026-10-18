import { describe, expect, it } from 'vitest'
import { canOfferSoft, downloadPercent, phaseFromStatus } from './playModel'

describe('phaseFromStatus', () => {
  it('maps Play install states', () => {
    expect(phaseFromStatus(1)).toBe('downloading')
    expect(phaseFromStatus(2)).toBe('downloading')
    expect(phaseFromStatus(11)).toBe('downloaded')
    expect(phaseFromStatus(5)).toBe('failed')
    expect(phaseFromStatus(6)).toBe('failed')
    expect(phaseFromStatus(0)).toBe('idle')
    expect(phaseFromStatus(4)).toBe('idle')
  })
})

describe('downloadPercent', () => {
  it('rounds, clamps, and is null without a total', () => {
    expect(downloadPercent(42, 100)).toBe(42)
    expect(downloadPercent(1, 3)).toBe(33)
    expect(downloadPercent(500, 100)).toBe(100)
    expect(downloadPercent(10, 0)).toBeNull()
  })
})

describe('canOfferSoft', () => {
  it('without the native module the server decides', () => {
    expect(canOfferSoft(false, null)).toBe(true)
  })
  it('with the module, only when Play offers a flexible update', () => {
    expect(canOfferSoft(true, null)).toBe(false)
    expect(canOfferSoft(true, { available: false })).toBe(false)
    expect(canOfferSoft(true, { available: true, flexibleAllowed: false })).toBe(false)
    expect(canOfferSoft(true, { available: true, flexibleAllowed: true })).toBe(true)
  })
})
