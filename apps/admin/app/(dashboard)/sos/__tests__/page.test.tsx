// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SosAlert } from '@/lib/safety-api'

const api = vi.hoisted(() => ({ getSosAlerts: vi.fn(), acknowledgeSos: vi.fn(), resolveSos: vi.fn() }))
// The page subscribes to 'sos:alert'; the test fires it by hand.
const socket = vi.hoisted(() => ({ handlers: {} as Record<string, () => void> }))
vi.mock('@/lib/safety-api', () => ({ safetyApi: api }))
vi.mock('@/lib/socket', () => ({
  getAdminSocket: () => ({ on: (e: string, fn: () => void) => { socket.handlers[e] = fn }, off: vi.fn() }),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import SOSPage from '../page'

const COUNTS = { triggered: 1, acknowledged: 0, responding: 0, resolved: 4, false_alarm: 2 }

function alert(over: Partial<SosAlert> = {}): SosAlert {
  return {
    id: '7', ride_id: '99', severity: 'medium', status: 'triggered',
    triggered_by_user: '1', triggered_by_driver: null,
    user_name: 'Asha Rider', user_phone: '+919800000001', driver_name: null, driver_phone: null,
    origin_address: 'Patia', destination_address: 'Puri',
    location_lat: '20.3', location_lng: '85.8', notes: null,
    acknowledged_by: null, acknowledged_by_email: null, acknowledged_at: null,
    resolved_by_email: null, resolved_at: null, resolution_note: null,
    created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
    ...over,
  }
}

const respond = (open: SosAlert[], recent: SosAlert[] = open, counts = COUNTS) =>
  api.getSosAlerts.mockImplementation((p?: { status?: string }) =>
    Promise.resolve({ alerts: p?.status === 'active' ? open : recent, total: open.length, counts }))

const conflict = (code: string, error: string) =>
  Object.assign(new Error('x'), { isAxiosError: true, response: { status: 409, data: { code, error } } })

beforeEach(() => { vi.clearAllMocks() })

describe('SOS page', () => {
  it('never says "all clear" when the alerts could not be loaded', async () => {
    api.getSosAlerts.mockRejectedValue(new Error('network'))
    render(<SOSPage />)
    expect(await screen.findByText(/can.t load sos alerts/i)).toBeTruthy()
    expect(screen.queryByText(/no active sos alerts/i)).toBeNull()
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy()
  })

  it('keeps the last alerts on screen, with a warning, when a later refresh fails', async () => {
    respond([alert()])
    render(<SOSPage />)
    expect(await screen.findByText(/waiting for someone to acknowledge/i)).toBeTruthy()
    // a new-alert push from the socket makes the page reload; this time the server is unreachable
    api.getSosAlerts.mockRejectedValue(new Error('network'))
    act(() => { socket.handlers['sos:alert']!() })
    expect(await screen.findByText(/can.t reach the server/i)).toBeTruthy()
    expect(screen.getByText(/waiting for someone to acknowledge/i)).toBeTruthy()
    expect(screen.queryByText(/no active sos alerts/i)).toBeNull()
  })

  it('shows an active alert with the waiting line, and a warning when there is no location', async () => {
    respond([alert({ location_lat: null, location_lng: null })])
    render(<SOSPage />)
    expect(await screen.findByText(/waiting for someone to acknowledge/i)).toBeTruthy()
    expect(screen.getByText(/no location shared/i)).toBeTruthy()
  })

  it('counts the stat cards from the server totals, not from the rows on screen', async () => {
    respond([alert()], [alert()])
    render(<SOSPage />)
    await screen.findByText(/waiting for someone/i)
    // 1 + 0 + 0 open, 7 in total, though only one row was returned
    await waitFor(() => expect(screen.getByText('7')).toBeTruthy())
  })

  it('reloads and says why when someone else already acknowledged the alert', async () => {
    respond([alert()])
    api.acknowledgeSos.mockRejectedValue(conflict('SOS_STATE_CONFLICT', 'This alert is already acknowledged'))
    render(<SOSPage />)
    await userEvent.setup().click(await screen.findByRole('button', { name: /^acknowledge$/i }))
    expect(await screen.findByText('This alert is already acknowledged')).toBeTruthy()
    // the 409 triggers a refresh: 2 calls on first load + 2 after
    await waitFor(() => expect(api.getSosAlerts.mock.calls.length).toBeGreaterThanOrEqual(4))
  })

  it('will not dismiss a false alarm without a note, and sends the note when given', async () => {
    respond([alert()])
    api.resolveSos.mockResolvedValue(alert({ status: 'false_alarm' }))
    const user = userEvent.setup()
    render(<SOSPage />)
    await user.click(await screen.findByRole('button', { name: /false alarm/i }))
    const confirm = await screen.findByRole('button', { name: /dismiss alert/i })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByRole('textbox'), 'Called her, pressed by mistake')
    expect((confirm as HTMLButtonElement).disabled).toBe(false)
    await user.click(confirm)
    await waitFor(() => expect(api.resolveSos).toHaveBeenCalledWith('7', { status: 'false_alarm', note: 'Called her, pressed by mistake' }))
  })

  it('does not lock the note dialog while a different alert is being acknowledged', async () => {
    const a = alert({ id: '7', user_name: 'Asha Rider' })
    const b = alert({ id: '8', user_name: 'Bikash Nayak', created_at: new Date(Date.now() - 2 * 60_000).toISOString() })
    respond([a, b])
    let release!: () => void
    api.acknowledgeSos.mockReturnValue(new Promise(res => { release = () => res(a) }))
    const user = userEvent.setup()
    render(<SOSPage />)
    const acks = await screen.findAllByRole('button', { name: 'Acknowledge' })
    await user.click(acks[0]!) // alert 7 is in flight
    const falseAlarms = await screen.findAllByRole('button', { name: /false alarm/i })
    await user.click(falseAlarms[1]!) // the dialog is for alert 8
    await user.type(await screen.findByRole('textbox'), 'checked by phone')
    expect((screen.getByRole('button', { name: 'Dismiss alert' }) as HTMLButtonElement).disabled).toBe(false)
    release()
  })

  it('a plain resolve needs no note and sends none', async () => {
    respond([alert()])
    api.resolveSos.mockResolvedValue(alert({ status: 'resolved' }))
    const user = userEvent.setup()
    render(<SOSPage />)
    await user.click(await screen.findByRole('button', { name: 'Mark Resolved' }))
    await user.click(await screen.findByRole('button', { name: 'Mark resolved' }))
    await waitFor(() => expect(api.resolveSos).toHaveBeenCalledWith('7', { status: 'resolved' }))
  })

  it('shows who handled an alert and the note in the history table', async () => {
    const closed = alert({ id: '3', status: 'resolved', resolved_by_email: 'ops@ocar.in', resolution_note: 'Rider safe' })
    respond([], [closed], { ...COUNTS, triggered: 0 })
    render(<SOSPage />)
    expect(await screen.findByText('Resolved by ops@ocar.in')).toBeTruthy()
    expect(screen.getByText('“Rider safe”')).toBeTruthy()
  })
})
