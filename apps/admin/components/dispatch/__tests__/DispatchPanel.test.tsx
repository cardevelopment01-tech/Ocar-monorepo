// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const api = vi.hoisted(() => ({ getById: vi.fn(), getAssignCandidates: vi.fn(), assignDriver: vi.fn() }))
vi.mock('@/lib/admin-api', () => ({ adminRideApi: api }))
const dApi = vi.hoisted(() => ({ cancelRide: vi.fn(), rescheduleRide: vi.fn(), reserveDriver: vi.fn(), releaseReservation: vi.fn() }))
vi.mock('@/lib/dispatch-api', () => ({ dispatchApi: dApi }))
vi.mock('@/lib/http-errors', async (orig) => ({ ...(await orig<object>()), extractErrorCode: (e: { code?: string }) => e?.code }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import DispatchPanel from '../DispatchPanel'
import { toIstInput } from '@/lib/ist'

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString()

const detail = (over: Record<string, unknown> = {}) => ({
  id: '77', status: 'scheduled', user_name: 'Anita Rout', user_phone: '+919437000001', fare: '1850', category_name: 'Sedan', origin_city: 'Bhubaneswar',
  origin_address: 'Airport', destination_address: 'Cuttack', requested_at: inMinutes(-600), scheduled_for: inMinutes(315), dispatch_at: inMinutes(300), offers: [], ...over,
})
const cand = (over: Record<string, unknown> = {}) => ({
  driver_id: '1', driver_name: 'Ravi Das', driver_phone: '+919000000001', category_name: 'Sedan', city_billing_mode: 'commission',
  is_online: true, category_ok: true, wallet_ok: true, distance_metres: 2400, eligible: true, ...over,
})

function setup(d = detail(), cands = [cand()], canAssign = true) {
  api.getById.mockResolvedValue(d)
  api.getAssignCandidates.mockResolvedValue(cands)
  api.assignDriver.mockResolvedValue(undefined)
  const onAssigned = vi.fn()
  const onChanged = vi.fn()
  render(<DispatchPanel rideId="77" canAssign={canAssign} onClose={() => {}} onAssigned={onAssigned} onChanged={onChanged} />)
  return { onAssigned, onChanged, user: userEvent.setup() }
}

beforeEach(() => { vi.clearAllMocks() })

describe('DispatchPanel', () => {
  it('asks only for online drivers until someone searches', async () => {
    setup()
    await screen.findByText('Ravi Das')
    expect(api.getAssignCandidates).toHaveBeenCalledWith('77', { online: true })
  })

  it('searches across every driver on the server, not by filtering the loaded list', async () => {
    const { user } = setup()
    await screen.findByText('Ravi Das')
    await user.type(screen.getByLabelText('Search drivers by name or phone'), 'sahoo')
    await waitFor(() => expect(api.getAssignCandidates).toHaveBeenLastCalledWith('77', { q: 'sahoo' }))
  })

  it('warns that asking or booking a far-off advance booking opens it for dispatch now, and points at Reserve', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('radio', { name: /Ask the driver/ }))
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent(/opens it for dispatch immediately/)
    expect(note).toHaveTextContent(/use Reserve/)
  })

  it('stays quiet about timing for a ride already in dispatch', async () => {
    setup(detail({ status: 'no_drivers', scheduled_for: null, dispatch_at: inMinutes(-30) }))
    await screen.findByText('Ravi Das')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('needs a second click when the ride is being pulled forward, and sends the request only after Confirm', async () => {
    const { user, onAssigned } = setup()
    await user.click(await screen.findByRole('radio', { name: /Ask the driver/ }))
    await user.click(await screen.findByRole('button', { name: 'Ask' }))
    expect(api.assignDriver).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'Confirm' }))
    expect(api.assignDriver).toHaveBeenCalledWith('77', '1', 'request', false)
    await waitFor(() => expect(onAssigned).toHaveBeenCalledWith('Request sent to Ravi Das'))
  })

  it('asks for confirmation before booking directly, even for a ride already in dispatch', async () => {
    const { user } = setup(detail({ status: 'requested', scheduled_for: null, dispatch_at: inMinutes(-10) }))
    await screen.findByText('Ravi Das')
    await user.click(screen.getByRole('radio', { name: /Book directly/ }))
    await user.click(screen.getByRole('button', { name: 'Book' }))
    expect(api.assignDriver).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(api.assignDriver).toHaveBeenCalledWith('77', '1', 'force', false)
  })

  it('an Ask on a ride already in dispatch goes straight through', async () => {
    const { user } = setup(detail({ status: 'no_drivers', scheduled_for: null, dispatch_at: inMinutes(-30) }))
    await user.click(await screen.findByRole('button', { name: 'Ask' }))
    expect(api.assignDriver).toHaveBeenCalledWith('77', '1', 'request', false)
  })

  it('an offline driver found by search cannot be picked, and says why', async () => {
    setup(detail({ status: 'no_drivers', scheduled_for: null, dispatch_at: inMinutes(-30) }), [cand({ is_online: false, eligible: false })])
    const btn = await screen.findByRole('button', { name: 'Offline' })
    expect(btn).toBeDisabled()
  })

  it('a flagged but online driver needs an explicit override, which names the reason and passes it to the API', async () => {
    const { user } = setup(detail({ status: 'no_drivers', scheduled_for: null, dispatch_at: inMinutes(-30) }), [cand({ eligible: false, wallet_ok: false })])
    await user.click(await screen.findByRole('button', { name: 'Assign anyway' }))
    expect(screen.getByText(/is flagged: below minimum balance/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(api.assignDriver).toHaveBeenCalledWith('77', '1', 'request', true)
  })

  it('shows the API reason when assigning fails', async () => {
    const { user } = setup(detail({ status: 'no_drivers', scheduled_for: null, dispatch_at: inMinutes(-30) }))
    api.assignDriver.mockRejectedValue(new Error('x'))
    await user.click(await screen.findByRole('button', { name: 'Ask' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Assignment failed/)
  })

  it('shows the ride but no assign controls to a role that cannot assign', async () => {
    setup(detail(), [cand()], false)
    await screen.findByText('Anita Rout')
    expect(screen.getByText(/can see the queue but not assign/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull()
  })

  it('does not offer assignment for a ride that is no longer open', async () => {
    setup(detail({ status: 'accepted' }))
    expect(await screen.findByText(/can no longer be assigned/)).toBeInTheDocument()
    expect(within(document.body).queryByRole('radiogroup')).toBeNull()
  })
})

describe('DispatchPanel: opened over the live map', () => {
  it('tells the map which drivers it lists, once they load', async () => {
    api.getById.mockResolvedValue(detail({ status: 'requested', scheduled_for: null, dispatch_at: inMinutes(-2) }))
    api.getAssignCandidates.mockResolvedValue([cand(), cand({ driver_id: '2', driver_name: 'Sita Nayak', distance_metres: 900 })])
    const onCandidates = vi.fn()
    render(<DispatchPanel rideId="77" canAssign onClose={() => {}} onAssigned={() => {}} onChanged={() => {}} onCandidates={onCandidates} overMap />)
    await screen.findByText('Ravi Das')
    const lastCall = onCandidates.mock.calls.at(-1)![0] as Array<{ driver_id: string }>
    expect(lastCall.map(c => c.driver_id)).toEqual(['1', '2'])
  })

  it('tells the map there is nobody when the panel closes', async () => {
    api.getById.mockResolvedValue(detail({ status: 'requested', scheduled_for: null, dispatch_at: inMinutes(-2) }))
    api.getAssignCandidates.mockResolvedValue([cand()])
    const onCandidates = vi.fn()
    const { rerender } = render(<DispatchPanel rideId="77" canAssign onClose={() => {}} onAssigned={() => {}} onChanged={() => {}} onCandidates={onCandidates} overMap />)
    await screen.findByText('Ravi Das')
    rerender(<DispatchPanel rideId={null} canAssign onClose={() => {}} onAssigned={() => {}} onChanged={() => {}} onCandidates={onCandidates} overMap />)
    await waitFor(() => expect(onCandidates.mock.calls.at(-1)![0]).toEqual([]))
  })

  it('leaves out the dimming layer so the map stays visible, and keeps it everywhere else', async () => {
    api.getById.mockResolvedValue(detail())
    api.getAssignCandidates.mockResolvedValue([cand()])
    const { unmount } = render(<DispatchPanel rideId="77" canAssign onClose={() => {}} onAssigned={() => {}} onChanged={() => {}} overMap />)
    await screen.findByText('Ravi Das')
    expect(document.querySelector('[class~="bg-black/50"]')).toBeNull()
    unmount()
    render(<DispatchPanel rideId="77" canAssign onClose={() => {}} onAssigned={() => {}} onChanged={() => {}} />)
    await screen.findByText('Ravi Das')
    expect(document.querySelector('[class~="bg-black/50"]')).not.toBeNull()
  })
})

describe('DispatchPanel: support actions on a ride', () => {
  const REASON = 'Rider called: flight cancelled'

  it('offers Change time and Cancel ride for an advance booking, to a role that can act', async () => {
    setup()
    expect(await screen.findByRole('button', { name: 'Change time' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel ride' })).toBeInTheDocument()
  })

  it('offers only Cancel ride (no time to change) once the ride is in dispatch', async () => {
    setup(detail({ status: 'no_drivers', scheduled_for: null, dispatch_at: inMinutes(-30) }))
    await screen.findByText('Ravi Das')
    expect(screen.getByRole('button', { name: 'Cancel ride' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change time' })).toBeNull()
  })

  it('offers neither to a role that cannot act', async () => {
    setup(detail(), [cand()], false)
    await screen.findByText('Anita Rout')
    expect(screen.queryByRole('button', { name: 'Cancel ride' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change time' })).toBeNull()
  })

  it('offers neither for a ride a driver already has', async () => {
    setup(detail({ status: 'accepted' }))
    await screen.findByText(/can no longer be assigned/)
    expect(screen.queryByRole('button', { name: 'Cancel ride' })).toBeNull()
  })

  it('cancels only with a reason of at least 10 characters, then tells the desk', async () => {
    dApi.cancelRide.mockResolvedValue(undefined)
    const { user, onChanged } = setup()
    await user.click(await screen.findByRole('button', { name: 'Cancel ride' }))
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Cancel ride' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByRole('textbox'), 'too short')
    expect(confirm).toBeDisabled()
    await user.clear(within(dialog).getByRole('textbox'))
    await user.type(within(dialog).getByRole('textbox'), REASON)
    await user.click(confirm)
    expect(dApi.cancelRide).toHaveBeenCalledWith('77', REASON)
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Ride #77 cancelled'))
  })

  it('shows why a cancel failed instead of closing silently', async () => {
    dApi.cancelRide.mockRejectedValue(new Error('x'))
    const { user, onChanged } = setup()
    await user.click(await screen.findByRole('button', { name: 'Cancel ride' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByRole('textbox'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel ride' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not cancel this ride/)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('changes the time: India time in, an ISO instant out, with the reason', async () => {
    dApi.rescheduleRide.mockResolvedValue(undefined)
    const { user, onChanged } = setup()
    await user.click(await screen.findByRole('button', { name: 'Change time' }))
    const dialog = await screen.findByRole('dialog')
    const target = new Date(Date.now() + 3 * 86_400_000)
    target.setSeconds(0, 0)
    fireEvent.change(within(dialog).getByLabelText(/New pickup time/), { target: { value: toIstInput(target) } })
    await user.type(within(dialog).getByLabelText(/Reason/), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Change time' }))
    expect(dApi.rescheduleRide).toHaveBeenCalledWith('77', target.toISOString(), REASON)
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('Ride #77 moved to the new time'))
  })

  it('refuses a time under an hour away or more than a week away, before asking the server', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Change time' }))
    const dialog = await screen.findByRole('dialog')
    const box = within(dialog).getByLabelText(/New pickup time/)
    await user.type(within(dialog).getByLabelText(/Reason/), REASON)
    fireEvent.change(box, { target: { value: toIstInput(new Date(Date.now() + 20 * 60_000)) } })
    expect(within(dialog).getByRole('status')).toHaveTextContent(/at least 60 minutes/)
    expect(within(dialog).getByRole('button', { name: 'Change time' })).toBeDisabled()
    fireEvent.change(box, { target: { value: toIstInput(new Date(Date.now() + 9 * 86_400_000)) } })
    expect(within(dialog).getByRole('status')).toHaveTextContent(/at most 7 days/)
    expect(dApi.rescheduleRide).not.toHaveBeenCalled()
  })

  describe('reserving a driver for an advance booking', () => {
    it('is the default for a booking made ahead, and offers it first', async () => {
      const { user } = setup()
      expect(await screen.findByRole('radio', { name: /Reserve a driver/ })).toHaveAttribute('aria-checked', 'true')
      expect(screen.queryByRole('note')).toBeNull() // no "opens it for dispatch" warning: reserving does not
      await user.click(await screen.findByRole('button', { name: 'Reserve' }))
      expect(dApi.reserveDriver).toHaveBeenCalledWith('77', '1', false)
      expect(api.assignDriver).not.toHaveBeenCalled()
    })

    it('is not offered for a ride that is already in dispatch', async () => {
      setup(detail({ status: 'no_drivers', scheduled_for: null, dispatch_at: inMinutes(-30) }))
      await screen.findByText('Ravi Das')
      expect(screen.queryByRole('radio', { name: /Reserve a driver/ })).toBeNull()
    })

    it('can reserve a driver who is offline right now, and looks at every driver, not only the online ones', async () => {
      const { user } = setup(detail(), [cand({ is_online: false, eligible: false })])
      await waitFor(() => expect(api.getAssignCandidates).toHaveBeenLastCalledWith('77', {}))
      const btn = await screen.findByRole('button', { name: 'Reserve anyway' })
      expect(btn).toBeEnabled()
      expect(screen.getByText('Offline now')).toBeInTheDocument()
      await user.click(btn)
      expect(dApi.reserveDriver).toHaveBeenCalledWith('77', '1', false)
    })

    it('says so when it overlaps the other booking the driver already holds, and can be overridden', async () => {
      dApi.reserveDriver.mockRejectedValueOnce({ isAxiosError: true, code: 'RESERVATION_OVERLAP', response: { status: 409, data: { error: 'Driver already has a booking at 6:00 pm that overlaps this one', code: 'RESERVATION_OVERLAP' } } })
      const { user } = setup()
      await user.click(await screen.findByRole('button', { name: 'Reserve' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(/overlaps/)
      await user.click(screen.getByRole('button', { name: 'Reserve anyway' }))
      expect(dApi.reserveDriver).toHaveBeenLastCalledWith('77', '1', true)
    })

    it('shows who is reserved and whether they confirmed, with their late hand-back count, and releases on a second click', async () => {
      const { user, onChanged } = setup(detail({ reserved_driver_id: '1', reserved_driver_name: 'Ravi Das', reserved_driver_phone: '+919000000001', reservation_confirmed_at: null, reserved_driver_late_releases: 2 }))
      expect(await screen.findByText('Reserved driver')).toBeInTheDocument()
      expect(screen.getByText(/Not confirmed yet/)).toBeInTheDocument()
      expect(screen.getByText(/2 late hand-backs in the last 30 days/)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Release' }))
      expect(dApi.releaseReservation).not.toHaveBeenCalled()
      await user.click(screen.getByRole('button', { name: 'Release' }))
      await waitFor(() => expect(dApi.releaseReservation).toHaveBeenCalledWith('77'))
      await waitFor(() => expect(onChanged).toHaveBeenCalled())
    })
  })
})
