// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AudiencePreview, BroadcastSummary } from '@/lib/broadcast-api'

const api = vi.hoisted(() => ({ preview: vi.fn(), send: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/broadcast-api', () => ({ broadcastApi: api }))
vi.mock('@/lib/city-api', () => ({ cityApi: { list: () => Promise.resolve([{ id: 1, name: 'Bhubaneswar' }, { id: 2, name: 'Cuttack' }]) } }))
vi.mock('@/lib/vehicle-api', () => ({ vehicleCategoryApi: { list: () => Promise.resolve([{ id: '3', display_name: 'SUV' }, { id: '4', display_name: 'Luxury SUV' }]) } }))

import BroadcastsPage from '../page'

// Value: protects=an admin can set up an audience, check who will really get it (push or in-app only, and who was left out and why), is
// stopped from sending something unchecked, is asked before a large send, and can follow what happened to each broadcast afterwards;
// fails_when=Send is reachable without a check, a large send goes out without a confirmation, the breakdown or the rider-app warning
// disappears, or the history stops updating while results are still arriving; why_new=the old page showed one number and then nothing
// ("Sending..." and the message was gone, with no way to see delivery); seam=the API client is replaced; no_claim=real delivery.

const preview = (over: Partial<AudiencePreview> = {}): AudiencePreview => ({
  matched: 60, recipientCount: 50, withDevice: 30, inAppOnly: 20, skippedOptedOut: 6, skippedCapped: 4, dailyCap: 2, sendableNow: true, phonesNotFound: [], ...over,
})
const row = (over: Partial<BroadcastSummary> = {}): BroadcastSummary => ({
  id: '7', title: 'Ocar is live', body: 'Stay online.', category: 'announcement', audience: { role: 'driver', cityIds: [2], docIssues: true },
  status: 'done', sentBy: 'ops@ocar.app', createdAt: '2026-11-17T06:41:04.000Z', finishedAt: '2026-11-17T06:41:06.000Z',
  sent: 578, pushed: 333, pushFailed: 17, noPush: 228, opened: 27, failed: 0, skippedOptedOut: 3, skippedCapped: 2, settling: false, ...over,
})

async function fillMessage(user: ReturnType<typeof userEvent.setup>, title = 'Hello', body = 'World') {
  await user.type(screen.getByLabelText(/^Title/), title)
  await user.type(screen.getByLabelText(/^Message/), body)
}

describe('Broadcasts page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.list.mockResolvedValue({ broadcasts: [], nextBefore: null })
    api.preview.mockResolvedValue(preview())
    api.send.mockResolvedValue({ id: '8', recipientCount: 50, withDevice: 30 })
  })

  it('cannot check or send anything until there is a title and a message', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    const check = screen.getByRole('button', { name: 'Check audience' })
    expect(check).toBeDisabled()
    await user.type(screen.getByLabelText(/^Title/), 'Hello')
    expect(check).toBeDisabled()
    await user.type(screen.getByLabelText(/^Message/), 'World')
    expect(check).toBeEnabled()
    expect(screen.queryByRole('button', { name: /^Send to/ })).toBeNull() // Send only appears after a check
  })

  it('checks the audience and shows who gets the push, who only the in-app, and who was left out and why', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.click(screen.getByRole('button', { name: 'Check audience' }))

    const box = await screen.findByLabelText('Audience check')
    expect(api.preview).toHaveBeenCalledWith('announcement', { role: 'driver' })
    expect(within(box).getByText('50 drivers will be notified')).toBeInTheDocument()
    expect(within(box).getByText(/also get the push on their phone/)).toBeInTheDocument()
    expect(within(box).getByText(/get the in-app notification only/)).toBeInTheDocument()
    expect(within(box).getByText(/6 left out: switched this type off/)).toBeInTheDocument()
    expect(within(box).getByText(/4 left out: already got 2 broadcasts in the last 24 hours/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send to 50 people' })).toBeEnabled()
  })

  it('sends the filters the admin chose', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await user.click(screen.getByLabelText(/Only drivers blocked by a document/))
    await fillMessage(user)
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    await screen.findByLabelText('Audience check')
    expect(api.preview).toHaveBeenCalledWith('announcement', { role: 'driver', docIssues: true })
  })

  it('changing anything after a check throws the check away, so what was checked is what is sent', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    await screen.findByLabelText('Audience check')
    await user.click(screen.getByLabelText(/Only drivers missing the RC back/))
    expect(screen.queryByLabelText('Audience check')).toBeNull()
    expect(screen.getByRole('button', { name: 'Check audience' })).toBeEnabled()
  })

  it('a small send goes straight through; the history then reloads', async () => {
    api.preview.mockResolvedValue(preview({ recipientCount: 5, withDevice: 5, inAppOnly: 0 }))
    api.send.mockResolvedValue({ id: '8', recipientCount: 5, withDevice: 5 })
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    await user.click(await screen.findByRole('button', { name: 'Send to 5 people' }))
    await waitFor(() => expect(api.send).toHaveBeenCalledWith({ title: 'Hello', body: 'World', category: 'announcement', audience: { role: 'driver' } }))
    expect(await screen.findByRole('status')).toHaveTextContent('Sending to 5 people')
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThanOrEqual(2)) // loaded once on open, again after the send
  })

  it('a large send asks first, and goes out only on "Send now"', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user, 'Big news')
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    await user.click(await screen.findByRole('button', { name: 'Send to 50 people' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Send to 50 drivers?')).toBeInTheDocument()
    expect(api.send).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1))
  })

  it('riders: warns that riders with no phone registration will not see it (the rider app has no notification list yet)', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await user.click(screen.getByRole('button', { name: 'Riders' }))
    await fillMessage(user)
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    expect(await screen.findByText(/rider app has no notification list yet/)).toBeInTheDocument()
    expect(api.preview).toHaveBeenCalledWith('announcement', { role: 'rider' })
  })

  it('an offer outside the allowed hours cannot be sent', async () => {
    api.preview.mockResolvedValue(preview({ sendableNow: false }))
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.selectOptions(screen.getByLabelText('Type'), 'offer')
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    expect(await screen.findByText(/Offers can only be sent between 10:00 and 21:00 IST/, { selector: 'p.text-error' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Send to/ })).toBeDisabled()
  })

  it('specific phone numbers: unreadable ones are flagged and block the check; readable ones are sent normalised', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.click(screen.getByLabelText(/Specific phone numbers only/))
    await user.type(screen.getByLabelText(/Phone numbers/), '12345')
    expect(screen.getByText(/not valid: 12345/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check audience' })).toBeDisabled()
    await user.clear(screen.getByLabelText(/Phone numbers/))
    await user.type(screen.getByLabelText(/Phone numbers/), '98610 03979')
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    await screen.findByLabelText('Audience check')
    expect(api.preview).toHaveBeenCalledWith('announcement', { role: 'driver', phones: ['+919861003979'] })
  })

  it('shows a phone number that matches nobody, and a server error in words', async () => {
    api.preview.mockResolvedValueOnce(preview({ recipientCount: 1, phonesNotFound: ['+918000000000'] }))
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.click(screen.getByLabelText(/Specific phone numbers only/))
    await user.type(screen.getByLabelText(/Phone numbers/), '98610 03979')
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    expect(await screen.findByText(/No active driver account for: \+918000000000/)).toBeInTheDocument()
  })
})

describe('Sent broadcasts', () => {
  beforeEach(() => { vi.clearAllMocks() })
  afterEach(() => { vi.useRealTimers() })

  it('says so when nothing has been sent', async () => {
    api.list.mockResolvedValue({ broadcasts: [], nextBefore: null })
    render(<BroadcastsPage />)
    expect(await screen.findByText('No broadcasts sent yet.')).toBeInTheDocument()
  })

  it('lists each broadcast with what happened to it, the audience in words, and who sent it', async () => {
    api.list.mockResolvedValue({ broadcasts: [row()], nextBefore: null })
    render(<BroadcastsPage />)
    const tr = (await screen.findByText('Ocar is live')).closest('tr')!
    expect(within(tr).getByText(/ops@ocar\.app/)).toBeInTheDocument()
    expect(within(tr).getByText('Drivers · Cuttack · blocked by documents')).toBeInTheDocument()
    expect(within(tr).getByText('Sent')).toBeInTheDocument()
    for (const n of ['578', '333', '228', '17', '27']) expect(within(tr).getByText(n)).toBeInTheDocument()
    expect(within(tr).getByText('5')).toBeInTheDocument() // left out: 3 opted out + 2 over the daily limit
  })

  it('shows a send to phone numbers as a count, and a failed or partial send plainly', async () => {
    api.list.mockResolvedValue({ broadcasts: [row({ id: '9', title: 'Test', audience: { role: 'driver', phoneCount: 2 }, status: 'failed', failed: 3 })], nextBefore: null })
    render(<BroadcastsPage />)
    const tr = (await screen.findByText('Test')).closest('tr')!
    expect(within(tr).getByText('2 phone numbers (drivers)')).toBeInTheDocument()
    expect(within(tr).getByText('Failed')).toBeInTheDocument()
    expect(within(tr).getByText('3 not sent')).toBeInTheDocument()
  })

  it('keeps refreshing while results are still coming in, and stops once they are settled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.list
      .mockResolvedValueOnce({ broadcasts: [row({ settling: true, noPush: 200, pushed: 300 })], nextBefore: null })
      .mockResolvedValue({ broadcasts: [row({ settling: false, noPush: 228, pushed: 333 })], nextBefore: null })
    render(<BroadcastsPage />)
    await screen.findByText('Ocar is live')
    expect(screen.getByText(/Updating while results come in/)).toBeInTheDocument()
    const callsBefore = api.list.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(8500) })
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(callsBefore))
    await waitFor(() => expect(screen.queryByText(/Updating while results come in/)).toBeNull())
    const settled = api.list.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(api.list.mock.calls.length).toBe(settled) // no more polling once everything has settled
  })

  it('"Show older" loads the next page after the ones already shown', async () => {
    api.list
      .mockResolvedValueOnce({ broadcasts: [row({ id: '9', title: 'Newer' })], nextBefore: '9' })
      .mockResolvedValueOnce({ broadcasts: [row({ id: '8', title: 'Older' })], nextBefore: null })
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await screen.findByText('Newer')
    await user.click(screen.getByRole('button', { name: 'Show older' }))
    expect(await screen.findByText('Older')).toBeInTheDocument()
    expect(api.list).toHaveBeenLastCalledWith({ limit: 20, before: '9' })
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull()
  })

  it('a refresh never drops rows that were already loaded further down, and keeps newest first', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.list
      .mockResolvedValueOnce({ broadcasts: [row({ id: '9', title: 'Nine', settling: true })], nextBefore: '9' })
      .mockResolvedValueOnce({ broadcasts: [row({ id: '8', title: 'Eight' })], nextBefore: null }) // "Show older"
      .mockResolvedValue({ broadcasts: [row({ id: '10', title: 'Ten' }), row({ id: '9', title: 'Nine', settling: false })], nextBefore: '9' }) // a poll
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<BroadcastsPage />)
    await screen.findByText('Nine')
    await user.click(screen.getByRole('button', { name: 'Show older' }))
    await screen.findByText('Eight')
    await act(async () => { await vi.advanceTimersByTimeAsync(8500) })
    await screen.findByText('Ten')
    const order = screen.getAllByText(/^(Ten|Nine|Eight)$/).map((e) => e.textContent)
    expect(order).toEqual(['Ten', 'Nine', 'Eight'])
  })

  it('a failed load says so instead of showing an empty list', async () => {
    api.list.mockRejectedValue(new Error('boom'))
    render(<BroadcastsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the sent broadcasts.')
  })
})
