// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const api = vi.hoisted(() => ({ getById: vi.fn(), getAssignCandidates: vi.fn(), assignDriver: vi.fn() }))
vi.mock('@/lib/admin-api', () => ({ adminRideApi: api }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))

import DispatchPanel from '../DispatchPanel'

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
  render(<DispatchPanel rideId="77" canAssign={canAssign} onClose={() => {}} onAssigned={onAssigned} />)
  return { onAssigned, user: userEvent.setup() }
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

  it('warns that assigning a far-off advance booking opens it for dispatch now', async () => {
    setup()
    expect(await screen.findByRole('note')).toHaveTextContent(/opens it for dispatch immediately/)
  })

  it('stays quiet about timing for a ride already in dispatch', async () => {
    setup(detail({ status: 'no_drivers', scheduled_for: null, dispatch_at: inMinutes(-30) }))
    await screen.findByText('Ravi Das')
    expect(screen.queryByRole('note')).toBeNull()
  })

  it('needs a second click when the ride is being pulled forward, and sends the request only after Confirm', async () => {
    const { user, onAssigned } = setup()
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
