// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Users } from 'lucide-react'
import StatCard, { StatBand } from '../ui/StatCard'

// Regression: StatCard is used by six admin pages (disputes, drivers, overview, rides, sos, vehicles).
// The band variant is additive and must not change the original card's props or output.
describe('StatCard (original props unchanged)', () => {
  it('renders title, change chip and icon card with the same props the six pages pass', () => {
    render(<StatCard title="Active drivers" value="12" change="+3" changeType="up" icon={Users} gradient="blue" />)
    expect(screen.getByText('Active drivers')).toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(document.querySelector('.admin-card')).not.toBeNull()
  })

  it('shows skeletons while loading', () => {
    const { container } = render(<StatCard title="Rides" value="0" change="" changeType="neutral" icon={Users} gradient="green" loading />)
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0)
  })
})

describe('StatBand (Reports KPI band, design D5)', () => {
  it('has no own card chrome, so six of them sit in one connected panel', () => {
    const { container } = render(<StatBand title="Completed rides" value="11" />)
    expect(container.querySelector('.admin-card')).toBeNull()
  })

  it('shows a delta with an arrow icon AND text (colour is never the only signal)', () => {
    const { container } = render(<StatBand title="Cancellation" value="33%" delta={{ text: '+5.0 pts', direction: 'up', tone: 'bad' }} />)
    expect(screen.getByText('+5.0 pts')).toBeInTheDocument()
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('shows the hint when there is no delta (no comparison data)', () => {
    render(<StatBand title="Gross bookings" value="₹2.2k" hint="no comparison data" />)
    expect(screen.getByText('no comparison data')).toBeInTheDocument()
  })

  it('renders as a labelled button and calls onClick when given one', async () => {
    const onClick = vi.fn()
    render(<StatBand title="Completed rides" value="11" onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: /Completed rides: 11/ }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders a plain block (not a button) without onClick', () => {
    render(<StatBand title="Active drivers" value="1" />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('draws a sparkline only with at least three points', () => {
    const { container, rerender } = render(<StatBand title="A" value="1" sparkline={[1, 2]} />)
    expect(container.querySelector('polyline')).toBeNull()
    rerender(<StatBand title="A" value="1" sparkline={[1, 2, 3]} />)
    expect(container.querySelector('polyline')).not.toBeNull()
  })

  it('shows a skeleton instead of the value while loading', () => {
    const { container } = render(<StatBand title="A" value="9" loading />)
    expect(container.querySelector('.skeleton')).not.toBeNull()
    expect(screen.queryByText('9')).toBeNull()
  })

  it('formats the raw value through `format` when provided', () => {
    render(<StatBand title="Gross" value="ignored" rawValue={2200} format={n => `₹${n / 1000}k`} />)
    expect(screen.getByText('₹2.2k')).toBeInTheDocument()
  })
})
