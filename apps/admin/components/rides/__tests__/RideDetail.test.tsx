// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const api = vi.hoisted(() => ({ getById: vi.fn(), trail: vi.fn(), addNote: vi.fn(), forceResolve: vi.fn() }))
const nav = vi.hoisted(() => ({ push: vi.fn() }))
const auth = vi.hoisted(() => ({ role: 'super_admin' as string }))
vi.mock('@/lib/admin-api', () => ({ adminRideApi: api }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }) }))
vi.mock('@/lib/auth-context', () => ({ useAdminAuth: () => ({ admin: { role: auth.role } }) }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
vi.mock('../RideMap', () => ({ default: () => <div data-testid="ride-map" /> }))

import RideDetail, { RIDES_NAV_KEY } from '../RideDetail'

const NOW = Date.now()
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString()

const base = (over: Record<string, unknown> = {}) => ({
  id: '77', status: 'completed', ride_type: 'one_way', is_return_cab: false, origin_address: 'Airport', destination_address: 'Cuttack', requested_at: minAgo(120),
  accepted_at: minAgo(115), driver_arrived_at: minAgo(105), started_at: minAgo(100), completed_at: minAgo(50), review_flagged_at: null, review_reason: null, cash_discrepancy: false,
  cash_collected_amount: null, user_name: 'Anita Rout', user_phone: '+919437000001', driver_name: 'Ravi Das', driver_phone: '+919437000010', fare: '1850',
  payment_status: 'paid', payment_channel: 'online_upi', cancellation_reason_code: null, cancellation_reason: null, cancellation_actor: null,
  user_id: '24', driver_id: '44', category_name: 'Sedan', origin_city: 'Bhubaneswar', destination_city: 'Cuttack', origin_lat: 20.2, origin_lng: 85.8, destination_lat: 20.4, destination_lng: 85.9,
  offers: [], stops: [], status_history: [], disputes: [], sos_alerts: [], ratings: [], messages: [], actual_km: '41.8', base_fare: '1500', distance_fare: '350',
  payment_amount: '1850', payment_txn_id: 'R77x123', payment_captured_at: minAgo(49), payment_failed_at: null, payment_failure_reason: null,
  commission_percent: '15', commission_amount: '277.5', driver_earning: '1572.5',
  otp: { trip_start: { verified_at: minAgo(100), failed_attempts: 1 }, trip_end: { verified_at: minAgo(50), failed_attempts: 0 } }, last_position: null, notes: [], ...over,
})

function setup(over: Record<string, unknown> = {}) {
  api.getById.mockResolvedValue(base(over))
  api.trail.mockResolvedValue([])
  render(<RideDetail rideId="77" />)
  return { user: userEvent.setup() }
}
const live = { status: 'in_progress', completed_at: null, payment_status: null, payment_channel: null, payment_amount: null, driver_earning: null }

beforeEach(() => {
  vi.clearAllMocks(); auth.role = 'super_admin'
  Element.prototype.scrollTo = vi.fn() as never
  window.scrollTo = vi.fn() as never
  sessionStorage.clear()
})

describe('RideDetail: says what the ride means', () => {
  it('a completed ride leads with how it went, in words', async () => {
    setup()
    expect(await screen.findByText('Completed in 50m · 41.8 km')).toBeInTheDocument()
    expect(screen.getByText('₹1,850 paid by UPI.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ride #77' })).toBeInTheDocument()
  })

  it('a flagged trip says it may be stuck and offers the call buttons', async () => {
    setup({ ...live, review_flagged_at: minAgo(10), review_reason: 'gps_stale' })
    expect(await screen.findByText(/^Possibly stuck/)).toBeInTheDocument()
    const sit = screen.getByRole('region', { name: 'Situation' })
    expect(within(sit).getByRole('link', { name: /Call driver/ })).toHaveAttribute('href', 'tel:+919437000010')
  })

  it('a ride nobody took explains who was asked and offers the Dispatch desk', async () => {
    const offers = [{ id: '1', driver_id: '5', driver_name: 'Kishore', driver_phone: '+91', status: 'declined', broadcast_round: 1, offered_at: minAgo(30), acked_at: null, responded_at: null, expires_at: minAgo(29), distance_km: 2 }]
    setup({ status: 'no_drivers', driver_name: null, driver_phone: null, driver_id: null, completed_at: null, started_at: null, offers })
    expect(await screen.findByText('No driver accepted this ride')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in Dispatch/ })).toHaveAttribute('href', '/dispatch?ride=77')
    expect(screen.getByText('Not assigned')).toBeInTheDocument()
  })
})

describe('RideDetail: the side column', () => {
  it('shows the people, and the trip codes with wrong tries', async () => {
    setup()
    const side = await screen.findByRole('complementary', { name: 'People and notes' })
    expect(within(side).getByText('Anita Rout')).toBeInTheDocument()
    expect(within(side).getByRole('link', { name: 'Ravi Das' })).toHaveAttribute('href', '/drivers/44')
    expect(within(side).getByText('Start code')).toBeInTheDocument()
    expect(within(side).getByText('1 wrong try')).toBeInTheDocument()
    expect(within(side).getAllByText(/^Verified/)).toHaveLength(2)
  })

  it('says a code is not verified yet', async () => {
    setup({ ...live, otp: { trip_start: { verified_at: minAgo(5), failed_attempts: 0 }, trip_end: { verified_at: null, failed_attempts: 3 } } })
    const side = await screen.findByRole('complementary', { name: 'People and notes' })
    expect(within(side).getByText('Not verified')).toBeInTheDocument()
    expect(within(side).getByText('3 wrong tries')).toBeInTheDocument()
  })

  it('shows when the driver was last heard from on a live trip, with a Maps link', async () => {
    setup({ ...live, last_position: { lat: 20.31, lng: 85.82, recorded_at: minAgo(4) } })
    expect(await screen.findByText(/Driver heard from/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open in Maps/ })).toHaveAttribute('href', expect.stringContaining('20.31,85.82'))
  })

  it('says plainly when no location was ever recorded', async () => {
    setup({ ...live, last_position: null })
    expect(await screen.findByText('No location has been recorded for this trip yet.')).toBeInTheDocument()
  })

  it('has no last-signal card on a finished ride', async () => {
    setup()
    await screen.findByText(/Completed in/)
    expect(screen.queryByText('Last signal')).toBeNull()
  })
})

describe('RideDetail: internal notes', () => {
  it('lists notes with who wrote them', async () => {
    setup({ notes: [{ id: '1', note: 'Rider called, driver is on the way', created_at: minAgo(3), admin_id: '9', admin_name: 'Meera' }] })
    expect(await screen.findByText('Rider called, driver is on the way')).toBeInTheDocument()
    expect(screen.getByText(/Meera/)).toBeInTheDocument()
  })

  it('adds a note, then reloads the ride', async () => {
    api.addNote.mockResolvedValue({ id: '2' })
    const { user } = setup()
    await screen.findByText(/Completed in/)
    expect(screen.getByRole('button', { name: 'Add note' })).toBeDisabled()
    await user.type(screen.getByLabelText('Add a note'), '  checked payment with the bank  ')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    await waitFor(() => expect(api.addNote).toHaveBeenCalledWith('77', 'checked payment with the bank'))
    await waitFor(() => expect(api.getById).toHaveBeenCalledTimes(2))
  })

  it('keeps what you typed and says so when saving fails', async () => {
    api.addNote.mockRejectedValue(new Error('x'))
    const { user } = setup()
    await screen.findByText(/Completed in/)
    await user.type(screen.getByLabelText('Add a note'), 'a note')
    await user.click(screen.getByRole('button', { name: 'Add note' }))
    expect(await screen.findByText(/Could not save the note/)).toBeInTheDocument()
    expect(screen.getByLabelText('Add a note')).toHaveValue('a note')
  })

  it('support admins can add notes too', async () => {
    auth.role = 'support_admin'
    setup()
    await screen.findByText(/Completed in/)
    expect(screen.getByLabelText('Add a note')).toBeInTheDocument()
  })
})

describe('RideDetail: tabs', () => {
  it('Safety appears only with something to show', async () => {
    setup({ sos_triggered: true, sos_triggered_at: minAgo(60) })
    expect(await screen.findByRole('tab', { name: /Safety/ })).toBeInTheDocument()
  })

  it('no Safety tab on an ordinary ride', async () => {
    setup()
    await screen.findByText(/Completed in/)
    expect(screen.queryByRole('tab', { name: /Safety/ })).toBeNull()
  })

  it('Money shows fare lines, the full payment record and what the driver keeps', async () => {
    const { user } = setup()
    await screen.findByText(/Completed in/)
    await user.click(screen.getByRole('tab', { name: 'Money' }))
    expect(await screen.findByText('Base fare')).toBeInTheDocument()
    expect(screen.getByText('Paid by')).toBeInTheDocument()
    expect(screen.getByText('Gateway reference')).toBeInTheDocument()
    expect(screen.getByText('R77x123')).toBeInTheDocument()
    expect(screen.getByText('Commission (15%)')).toBeInTheDocument()
    expect(screen.getByText('₹1,572.5')).toBeInTheDocument()
  })

  it('shows a failed payment and why', async () => {
    const { user } = setup({ payment_status: 'failed', payment_failed_at: minAgo(10), payment_failure_reason: 'Card declined', driver_earning: '0', payment_captured_at: null })
    await screen.findByText(/Completed in/)
    await user.click(screen.getByRole('tab', { name: 'Money' }))
    expect(await screen.findByText(/Card declined/)).toBeInTheDocument()
    expect(screen.queryByText('Driver earnings')).toBeNull()
  })

  it('Activity says plainly when there was no chat', async () => {
    const { user } = setup()
    await screen.findByText(/Completed in/)
    await user.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(screen.getByText('No messages were sent on this ride.')).toBeInTheDocument()
  })
})

describe('RideDetail: moving around', () => {
  it('steps through the list you came from, with arrows and J / K', async () => {
    sessionStorage.setItem(RIDES_NAV_KEY, JSON.stringify(['76', '77', '78']))
    const { user } = setup()
    await screen.findByText(/Completed in/)
    expect(await screen.findByText('2 of 3')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Next ride/ }))
    expect(nav.push).toHaveBeenLastCalledWith('/rides/78')
    await user.keyboard('k')
    expect(nav.push).toHaveBeenLastCalledWith('/rides/76')
  })

  it('disables the arrows when there is no list to step through', async () => {
    setup()
    await screen.findByText(/Completed in/)
    expect(screen.getByRole('button', { name: /Next ride/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Previous ride/ })).toBeDisabled()
  })

  it('does not step while typing a note', async () => {
    sessionStorage.setItem(RIDES_NAV_KEY, JSON.stringify(['77', '78']))
    const { user } = setup()
    await screen.findByText(/Completed in/)
    await user.type(screen.getByLabelText('Add a note'), 'jjj')
    expect(nav.push).not.toHaveBeenCalled()
  })
})

describe('RideDetail: actions', () => {
  it('keeps the irreversible actions behind More and says what each one does', async () => {
    const { user } = setup(live)
    await screen.findByText(/Trip in progress/)
    expect(screen.queryByRole('menuitem', { name: /Force cancel/ })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(await screen.findByRole('menuitem', { name: /Force complete/ })).toHaveTextContent('settles the fare at the booked estimate')
    expect(screen.getByRole('menuitem', { name: /Force cancel/ })).toHaveTextContent('The rider is not charged')
  })

  it('asks for a reason, then force-resolves and reloads', async () => {
    api.forceResolve.mockResolvedValue(undefined)
    const { user } = setup(live)
    await screen.findByText(/Trip in progress/)
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Force cancel/ }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('frees the driver')
    await user.type(within(dialog).getByRole('textbox'), 'driver phone dead, rider confirmed by call')
    await user.click(within(dialog).getByRole('button', { name: 'Force cancel' }))
    await waitFor(() => expect(api.forceResolve).toHaveBeenCalledWith('77', 'cancel', 'driver phone dead, rider confirmed by call'))
    await waitFor(() => expect(api.getById).toHaveBeenCalledTimes(2))
  })

  it('shows the error when the force action fails', async () => {
    api.forceResolve.mockRejectedValue(new Error('x'))
    const { user } = setup(live)
    await screen.findByText(/Trip in progress/)
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(await screen.findByRole('menuitem', { name: /Force complete/ }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), 'trip ended, app crashed on driver phone')
    await user.click(within(dialog).getByRole('button', { name: 'Force complete' }))
    expect(await screen.findByText(/Could not force complete this ride/)).toBeInTheDocument()
  })

  it('a role that cannot act sees no force actions even on a live ride', async () => {
    auth.role = 'support_admin'
    const { user } = setup(live)
    await screen.findByText(/Trip in progress/)
    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.queryByRole('menuitem', { name: /Force/ })).toBeNull()
    expect(screen.getByRole('menuitem', { name: /Copy ride ID/ })).toBeInTheDocument()
  })

  it('copies a short summary linking to this page', async () => {
    const write = vi.fn(async () => undefined)
    const { user } = setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true }) // after userEvent installs its own stub
    await screen.findByText(/Completed in/)
    await user.click(screen.getByRole('button', { name: /Copy summary/ }))
    await waitFor(() => expect(write).toHaveBeenCalled())
    const text = (write.mock.calls[0] as unknown as [string])[0]
    expect(text).toContain('Ride #77 · completed')
    expect(text).toContain('Rider: Anita Rout')
    expect(text).toContain('/rides/77')
  })

  it('says so when the clipboard is not available', async () => {
    const { user } = setup()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    await screen.findByText(/Completed in/)
    await user.click(screen.getByRole('button', { name: /Copy link/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not copy/)
  })
})

describe('RideDetail: loading and failures', () => {
  it('says it is loading, then shows the ride', async () => {
    setup()
    expect(screen.getByText('Loading ride…')).toBeInTheDocument()
    expect(await screen.findByText(/Completed in/)).toBeInTheDocument()
  })

  it('offers Retry when the ride cannot be loaded, and recovers', async () => {
    api.getById.mockRejectedValueOnce(new Error('x'))
    api.trail.mockResolvedValue([])
    render(<RideDetail rideId="77" />)
    const user = userEvent.setup()
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /All rides/ })).toHaveAttribute('href', '/rides')
    api.getById.mockResolvedValue(base())
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/Completed in/)).toBeInTheDocument()
  })

  it('marks an active ride Live', async () => {
    setup(live)
    expect(await screen.findByText('Live')).toBeInTheDocument()
  })
})
