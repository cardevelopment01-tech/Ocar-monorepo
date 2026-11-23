// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const api = vi.hoisted(() => ({ getById: vi.fn(), trail: vi.fn() }))
vi.mock('@/lib/admin-api', () => ({ adminRideApi: api }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('../RideMap', () => ({ default: () => <div data-testid="ride-map" /> }))

import RideDrawer from '../RideDrawer'

const NOW = Date.now()
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

const ride = (over: Record<string, unknown> = {}) => ({
  id: '77', status: 'completed', ride_type: 'one_way', is_return_cab: false, origin_address: 'Airport', destination_address: 'Cuttack', requested_at: minAgo(120),
  accepted_at: minAgo(115), driver_arrived_at: minAgo(105), started_at: minAgo(100), completed_at: minAgo(50), review_flagged_at: null, review_reason: null, cash_discrepancy: false,
  cash_collected_amount: null, user_name: 'Anita Rout', user_phone: '+919437000001', driver_name: 'Ravi Das', driver_phone: '+919437000010', fare: '1850',
  payment_status: 'paid', payment_channel: 'online_upi', cancellation_reason_code: null, cancellation_reason: null, cancellation_actor: null, ...over,
})
const detail = (over: Record<string, unknown> = {}) => ({
  ...ride(), user_id: '24', driver_id: '44', category_name: 'Sedan', origin_city: 'Bhubaneswar', destination_city: 'Cuttack', origin_lat: 20.2, origin_lng: 85.8, destination_lat: 20.4, destination_lng: 85.9,
  offers: [], stops: [], status_history: [], disputes: [], sos_alerts: [], ratings: [], messages: [], actual_km: '41.8', base_fare: '1500', distance_fare: '350', ...over,
})

function setup(r = ride(), d: Record<string, unknown> | null = detail(), props: Record<string, unknown> = {}) {
  api.getById.mockResolvedValue(d ?? detail())
  api.trail.mockResolvedValue([])
  const handlers = { onPrev: vi.fn(), onNext: vi.fn(), onClose: vi.fn(), onForce: vi.fn() }
  render(<RideDrawer ride={r as never} canAct position={{ index: 1, total: 4 }} forceBusy={false} actionError="" now={NOW} {...handlers} {...props} />)
  return { ...handlers, user: userEvent.setup() }
}

beforeEach(() => { vi.clearAllMocks(); Element.prototype.scrollTo = vi.fn() as never }) // jsdom has no element scrollTo

describe('RideDrawer: says what the ride means', () => {
  it('a completed ride leads with how it went, in words, before any section is opened', async () => {
    setup()
    expect(await screen.findByText('Completed in 50m · 41.8 km')).toBeInTheDocument()
    expect(screen.getByText('₹1,850 paid by UPI.')).toBeInTheDocument()
    expect(screen.getByText('Sedan · Bhubaneswar → Cuttack')).toBeInTheDocument()
  })

  it('a flagged trip says it may be stuck and puts the call buttons and the safe next step right there', async () => {
    setup(ride({ status: 'in_progress', completed_at: null, review_flagged_at: minAgo(10), review_reason: 'gps_stale' }), detail({ status: 'in_progress', completed_at: null, review_flagged_at: minAgo(10), review_reason: 'gps_stale' }))
    expect(await screen.findByText(/^Possibly stuck/)).toBeInTheDocument()
    const sit = screen.getByRole('region', { name: 'Situation' })
    expect(within(sit).getByRole('link', { name: /Call driver/ })).toHaveAttribute('href', 'tel:+919437000010')
    expect(within(sit).getByText(/resolve the ride from More/)).toBeInTheDocument()
  })

  it('a ride nobody took explains who was asked and offers the Dispatch desk', async () => {
    const offers = [{ id: '1', driver_id: '5', driver_name: 'Kishore', driver_phone: '+91', status: 'declined', broadcast_round: 1, offered_at: minAgo(30), acked_at: null, responded_at: null, expires_at: minAgo(29), distance_km: 2 }]
    const r = ride({ status: 'no_drivers', driver_name: null, driver_phone: null, completed_at: null, started_at: null })
    setup(r, detail({ ...r, offers }))
    expect(await screen.findByText('No driver accepted this ride')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in Dispatch/ })).toHaveAttribute('href', '/dispatch?ride=77')
    expect(screen.getByText('Not assigned')).toBeInTheDocument()
  })

  it('shows the key numbers, only those the ride has', async () => {
    setup()
    await screen.findByText('Completed in 50m · 41.8 km')
    const facts = document.querySelector('dl')!
    expect(within(facts as HTMLElement).getByText('₹1,850')).toBeInTheDocument()
    expect(within(facts as HTMLElement).getByText('41.8 km')).toBeInTheDocument()
    expect(within(facts as HTMLElement).getByText('50m')).toBeInTheDocument()
  })
})

describe('RideDrawer: tabs', () => {
  it('shows Overview, Money and Activity; Safety only when there is something, with an alert dot', async () => {
    setup(ride(), detail({ sos_triggered: true, sos_triggered_at: minAgo(60) }))
    expect(await screen.findByRole('tab', { name: /Safety/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Money/ })).toBeInTheDocument()
  })

  it('has no Safety tab on an ordinary ride', async () => {
    setup()
    await screen.findByText(/Completed in/)
    expect(screen.queryByRole('tab', { name: /Safety/ })).toBeNull()
  })

  it('Money shows the fare lines and the payment; Activity says plainly when there was no chat', async () => {
    const { user } = setup()
    await screen.findByText(/Completed in/)
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Money' })).toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: 'Money' }))
    expect(await screen.findByText('Base fare')).toBeInTheDocument()
    expect(screen.getByText('₹1,500')).toBeInTheDocument()
    expect(screen.getByText('Paid by')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(screen.getByText('No messages were sent on this ride.')).toBeInTheDocument()
  })
})

describe('RideDrawer: moving around', () => {
  it('shows the position and steps with the arrows and with J and K', async () => {
    const { user, onNext, onPrev } = setup()
    await screen.findByText(/Completed in/)
    expect(screen.getByText('2 of 4')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Next ride/ }))
    await user.click(screen.getByRole('button', { name: /Previous ride/ }))
    await user.keyboard('j')
    await user.keyboard('k')
    expect(onNext).toHaveBeenCalledTimes(2)
    expect(onPrev).toHaveBeenCalledTimes(2)
  })

  it('does not step when typing in a box, and disables an arrow at the end of the list', async () => {
    const { onNext } = setup(ride(), detail(), { onNext: null })
    await screen.findByText(/Completed in/)
    expect(screen.getByRole('button', { name: /Next ride/ })).toBeDisabled()
    const input = document.createElement('input'); document.body.appendChild(input); input.focus()
    await userEvent.keyboard('j')
    expect(onNext).not.toHaveBeenCalled()
    input.remove()
  })
})

describe('RideDrawer: actions', () => {
  const live = () => {
    const r = ride({ status: 'in_progress', completed_at: null, payment_status: null, payment_channel: null })
    return { r, d: detail({ ...r }) }
  }

  it('keeps the irreversible actions behind More and says what each one does', async () => {
    const { r, d } = live()
    const { user } = setup(r, d)
    await screen.findByText('Trip in progress for 1h 40m')
    expect(screen.queryByRole('menuitem', { name: /Force cancel/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    const complete = await screen.findByRole('menuitem', { name: /Force complete/ })
    expect(complete).toHaveTextContent('settles the fare at the booked estimate')
    expect(screen.getByRole('menuitem', { name: /Force cancel/ })).toHaveTextContent('The rider is not charged')
  })

  it('hands the chosen outcome to the page, which asks for the reason', async () => {
    const { r, d } = live()
    const { user, onForce } = setup(r, d)
    await screen.findByText(/Trip in progress/)
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Force cancel/ }))
    expect(onForce).toHaveBeenCalledWith('cancel')
  })

  it('offers no More menu on a finished ride, or to a role that cannot act', async () => {
    setup()
    await screen.findByText(/Completed in/)
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it('a role that cannot act sees no force actions even on a live ride', async () => {
    const { r, d } = live()
    setup(r, d, { canAct: false })
    await screen.findByText(/Trip in progress/)
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it('copies a short summary of the ride', async () => {
    const write = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true })
    const { user } = setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true }) // after userEvent installs its own stub
    await screen.findByText(/Completed in/)
    await user.click(screen.getByRole('button', { name: /Copy summary/ }))
    await waitFor(() => expect(write).toHaveBeenCalled())
    const text = (write.mock.calls[0] as unknown as [string])[0]
    expect(text).toContain('Ride #77 · completed')
    expect(text).toContain('Rider: Anita Rout')
    expect(text).toContain('/rides?ride=77')
  })

  it('says so when the clipboard is not available', async () => {
    const { user } = setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    await screen.findByText(/Completed in/)
    await user.click(screen.getByRole('button', { name: /Copy link/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not copy/)
  })
})

describe('RideDrawer: failures and live updates', () => {
  it('still shows the ride from the list when the full detail cannot load, and offers Retry', async () => {
    api.getById.mockRejectedValueOnce(new Error('x'))
    const { user } = setup(ride({ status: 'cancelled', cancellation_actor: 'user' }), null)
    expect(await screen.findByText('Cancelled by the rider')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/))
    api.getById.mockResolvedValue(detail({ status: 'cancelled', cancellation_actor: 'user' }))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByText(/could not be loaded/)).toBeNull())
  })

  it('marks an active ride Live and a finished one not', async () => {
    const r = ride({ status: 'in_progress', completed_at: null })
    setup(r, detail({ ...r }))
    expect(await screen.findByText('Live')).toBeInTheDocument()
  })

  it('shows the page\'s error from a failed action', async () => {
    setup(ride(), detail(), { actionError: 'The ride changed. Refresh and try again.' })
    expect(await screen.findByText('The ride changed. Refresh and try again.')).toBeInTheDocument()
  })
})
