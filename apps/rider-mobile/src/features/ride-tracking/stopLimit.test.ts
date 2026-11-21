import { describe, expect, it } from 'vitest'
import { stopsFull } from './stopLimit'

// Value: protects=a rider on a city ride is not offered "Add stop" once the ride already has its 2 stops (the city limit comes from the
// server), while other rides keep adding up to their limit, and an older server that sends no limit never hides the button;
// fails_when=the button shows on a full city ride and the rider taps into a refusal, or hides on a ride that still has room;
// why_new=city rides are limited to 2 stops; seam=none; no_claim=the screen layout.
describe('stopsFull', () => {
  it('is full when the ride has reached the limit the server sent', () => {
    expect(stopsFull(2, 2)).toBe(true)
    expect(stopsFull(3, 2)).toBe(true)
    expect(stopsFull(0, 0)).toBe(true)
  })
  it('has room below the limit', () => {
    expect(stopsFull(1, 2)).toBe(false)
    expect(stopsFull(2, 3)).toBe(false)
  })
  it('never hides the button when the server sent no limit (older server)', () => {
    expect(stopsFull(5, undefined)).toBe(false)
    expect(stopsFull(5, null)).toBe(false)
  })
})
