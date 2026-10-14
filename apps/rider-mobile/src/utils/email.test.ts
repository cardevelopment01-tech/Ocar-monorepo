import { describe, it, expect } from 'vitest'
import { isPlausibleEmail } from './email'

describe('isPlausibleEmail', () => {
  it('accepts ordinary addresses, ignoring surrounding spaces', () => {
    expect(isPlausibleEmail('a@b.co')).toBe(true)
    expect(isPlausibleEmail('  first.last+tag@example.in ')).toBe(true)
  })
  it('rejects the obvious typos', () => {
    for (const bad of ['abc', 'abc@', '@b.com', 'a@b', 'a b@c.com', 'a@@b.com', 'a@b.', '']) expect(isPlausibleEmail(bad)).toBe(false)
  })
})
