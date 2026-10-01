// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BookedTimeBlock, { formatHM } from '../rides/BookedTimeBlock'

const base = {
  status: 'completed',
  started_at: '2026-10-01T06:00:00.000Z',
  completed_at: '2026-10-01T12:20:00.000Z',
  review_reason: null,
  trip_hours: 6,
  overtimeGraceMin: 5,
  overtimeRate: 100,
  overtimeMin: 16,
  overtimeFare: 26.67,
}

describe('BookedTimeBlock', () => {
  it('shows booked, actual, grace and the settled overtime for a round trip that ran over', () => {
    render(<BookedTimeBlock ride={base} />)
    expect(screen.getByText('Booked time')).toBeInTheDocument()
    expect(screen.getByText('6h')).toBeInTheDocument()
    expect(screen.getByText('6h 20m')).toBeInTheDocument()
    expect(screen.getByText('5m')).toBeInTheDocument()
    expect(screen.getByText('16m · ₹26.67')).toBeInTheDocument()
  })

  it('says None when the trip stayed inside the window', () => {
    render(<BookedTimeBlock ride={{ ...base, completed_at: '2026-10-01T11:00:00.000Z', overtimeMin: 0, overtimeFare: 0 }} />)
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('is honest while the trip is still running', () => {
    render(<BookedTimeBlock ride={{ ...base, status: 'in_progress', completed_at: null, overtimeMin: null, overtimeFare: null }} />)
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText('Not settled yet')).toBeInTheDocument()
  })

  it('does not claim None for a ride that was closed without settling overtime (force-complete)', () => {
    render(<BookedTimeBlock ride={{ ...base, overtimeMin: null, overtimeFare: null }} />)
    expect(screen.getByText('Not calculated')).toBeInTheDocument()
    expect(screen.queryByText('None')).toBeNull()
  })

  it('puts the overtime review flag next to its numbers', () => {
    render(<BookedTimeBlock ride={{ ...base, review_reason: 'Round-trip overtime over 60 minutes' }} />)
    expect(screen.getByText(/Flagged for review: Round-trip overtime over 60 minutes/)).toBeInTheDocument()
  })

  it('ignores an unrelated review flag', () => {
    render(<BookedTimeBlock ride={{ ...base, review_reason: 'Ended early by driver: emergency' }} />)
    expect(screen.queryByText(/Flagged for review/)).toBeNull()
  })

  it.each([
    ['a ride with no window (one-way, rental, legacy, over 24h)', { overtimeGraceMin: null }],
    ['a ride with no booked hours', { trip_hours: null }],
  ])('renders nothing for %s', (_n, over) => {
    const { container } = render(<BookedTimeBlock ride={{ ...base, ...over }} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('formatHM', () => {
  it('formats hours and minutes', () => {
    expect(formatHM(380)).toBe('6h 20m')
    expect(formatHM(360)).toBe('6h')
    expect(formatHM(45)).toBe('45m')
  })
})
