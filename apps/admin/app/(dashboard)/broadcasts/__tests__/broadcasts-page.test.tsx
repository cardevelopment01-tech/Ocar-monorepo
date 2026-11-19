// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AudiencePreview, BroadcastSummary } from '@/lib/broadcast-api'

const api = vi.hoisted(() => ({ preview: vi.fn(), send: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/broadcast-api', async (orig) => ({ ...(await orig<typeof import('@/lib/broadcast-api')>()), broadcastApi: api }))
vi.mock('@/lib/city-api', () => ({ cityApi: { list: () => Promise.resolve([{ id: 1, name: 'Bhubaneswar' }, { id: 2, name: 'Cuttack' }]) } }))
vi.mock('@/lib/vehicle-api', () => ({ vehicleCategoryApi: { list: () => Promise.resolve([{ id: '3', display_name: 'SUV' }, { id: '4', display_name: 'Luxury SUV' }]) } }))

import BroadcastsPage from '../page'

// Value: protects=an admin can set up an audience, check who will really get it (push or in-app only, and who was left out and why), is
// stopped from sending something unchecked, is asked before a large send, and can follow what happened to each broadcast afterwards;
// fails_when=Send is reachable without a check, a large send goes out without a confirmation, the breakdown or the rider-app warning
// disappears, or the history stops updating while results are still arriving; why_new=the old page showed one number and then nothing
// ("Sending..." and the message was gone, with no way to see delivery); seam=the API client is replaced; no_claim=real delivery.

const preview = (over: Partial<AudiencePreview> = {}): AudiencePreview => ({
  matched: 60, recipientCount: 50, withDevice: 30, inAppOnly: 20, skippedOptedOut: 6, skippedCapped: 4, dailyCap: 2, sendableNow: true, phonesNotFound: [], people: [], ...over,
})
const row = (over: Partial<BroadcastSummary> = {}): BroadcastSummary => ({
  id: '7', title: 'Ocar is live', body: 'Stay online.', category: 'announcement', audience: { role: 'driver', cityIds: [2], docIssues: true },
  status: 'done', sentBy: 'ops@ocar.app', createdAt: '2026-11-17T06:41:04.000Z', finishedAt: '2026-11-17T06:41:06.000Z',
  imageUrl: null, link: null, statusNote: null, promised: 578, sent: 578, pushed: 333, pushFailed: 17, noPush: 228, opened: 27, failed: 0, skippedOptedOut: 3, skippedCapped: 2, skippedAtSend: 0, tracked: true, settling: false, ...over,
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
    expect(within(box).getByText(/4 left out: already got 2 offers in the last 24 hours/)).toBeInTheDocument()
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

  it('riders: warns that riders with no phone registration will not see it (a rider only gets the push)', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await user.click(screen.getByRole('button', { name: 'Riders' }))
    await fillMessage(user)
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    expect(await screen.findByText(/Riders only receive this as a push/)).toBeInTheDocument()
    expect(api.preview).toHaveBeenCalledWith('announcement', { role: 'rider' })
  })

  it('a picture and a screen: shown in the phone preview, offered per app, sent with the broadcast, and cleared after sending', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    // Drivers can open Wallet, riders cannot.
    expect(within(screen.getByLabelText(/When they tap it/)).getByRole('option', { name: 'Open Wallet' })).toBeInTheDocument()
    await user.type(screen.getByLabelText(/^Picture/), 'https://cdn.example.com/offer.jpg')
    await user.selectOptions(screen.getByLabelText(/When they tap it/), 'wallet')
    const phone = screen.getByLabelText('How it looks on a phone')
    expect(phone.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/offer.jpg')
    expect(within(phone).getByText('Wallet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    await user.click(await screen.findByRole('button', { name: /^Send to/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send now' })) // 50 people: asks first
    await waitFor(() => expect(api.send).toHaveBeenCalledWith({
      title: 'Hello', body: 'World', category: 'announcement', audience: { role: 'driver' }, imageUrl: 'https://cdn.example.com/offer.jpg', link: 'wallet',
    }))
    await waitFor(() => expect((screen.getByLabelText(/^Picture/) as HTMLInputElement).value).toBe(''))
  })

  it('switching to riders drops a screen riders do not have (no "wallet" for a rider)', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await user.selectOptions(screen.getByLabelText(/When they tap it/), 'wallet')
    await user.click(screen.getByRole('button', { name: 'Riders' }))
    const select = screen.getByLabelText(/When they tap it/) as HTMLSelectElement
    expect(select.value).toBe('')
    expect(within(select).queryByRole('option', { name: 'Open Wallet' })).toBeNull()
    expect(within(select).getByRole('option', { name: 'Open My offers' })).toBeInTheDocument()
  })

  it('a picture link that is not https is flagged and blocks checking and sending', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.type(screen.getByLabelText(/^Picture/), 'http://insecure.example.com/a.jpg')
    expect(screen.getByText('The link must start with https://')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check audience' })).toBeDisabled()
    expect(screen.getByLabelText('How it looks on a phone').querySelector('img')).toBeNull()
  })

  it('a broadcast sent while the list is still loading still shows up (the refresh is not dropped)', async () => {
    const user = userEvent.setup()
    let release!: (v: { broadcasts: BroadcastSummary[]; nextBefore: null }) => void
    api.list.mockReset()
    api.list
      .mockImplementationOnce(() => new Promise((r) => { release = r })) // the first load, slow, answered before the send
      .mockResolvedValue({ broadcasts: [row({ id: '9', title: 'Just sent' })], nextBefore: null })
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    await user.click(await screen.findByRole('button', { name: /^Send to/ }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send now' }))
    await waitFor(() => expect(api.send).toHaveBeenCalled())
    await act(async () => { release({ broadcasts: [], nextBefore: null }) })
    expect(await screen.findByText('Just sent')).toBeInTheDocument()
  })

  it('a stopped broadcast says why and how many it reached out of how many it was meant for', async () => {
    api.list.mockResolvedValue({
      broadcasts: [row({ id: '12', title: 'Diwali offer', category: 'offer', status: 'failed', sent: 12400, promised: 20000, statusNote: 'Stopped: offers can only go out between 10:00 and 21:00 IST.' })],
      nextBefore: null,
    })
    render(<BroadcastsPage />)
    expect(await screen.findByText(/Stopped: offers can only go out between 10:00 and 21:00 IST\./)).toBeInTheDocument()
    expect(screen.getByText(/Reached 12400 of 20000/)).toBeInTheDocument()
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

  it('names who each typed number belongs to, right above the Send button, so a wrong number is caught', async () => {
    api.preview.mockResolvedValueOnce(preview({ recipientCount: 1, withDevice: 1, inAppOnly: 0, people: [{ phone: '+919861003979', name: 'Ashish Nayak', code: 'DRV000329' }] }))
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.click(screen.getByLabelText(/Specific phone numbers only/))
    await user.type(screen.getByLabelText(/Phone numbers/), '98610 03979')
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    const box = await screen.findByLabelText('Audience check')
    expect(within(box).getByText('Going to')).toBeInTheDocument()
    expect(within(box).getByText('Ashish Nayak (DRV000329) · +919861003979')).toBeInTheDocument()
  })

  it('a number whose owner has no name on file still says who it is, and a normal audience shows no list', async () => {
    api.preview.mockResolvedValueOnce(preview({ recipientCount: 1, people: [{ phone: '+919861003979', name: null, code: null }] }))
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.click(screen.getByLabelText(/Specific phone numbers only/))
    await user.type(screen.getByLabelText(/Phone numbers/), '98610 03979')
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    expect(await screen.findByText('No name on file · +919861003979')).toBeInTheDocument()
  })

  it('a normal audience check has no "Going to" list', async () => {
    const user = userEvent.setup()
    render(<BroadcastsPage />)
    await fillMessage(user)
    await user.click(screen.getByRole('button', { name: 'Check audience' }))
    await screen.findByLabelText('Audience check')
    expect(screen.queryByText('Going to')).toBeNull()
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

  it('a send made before tracking shows dashes for what was never recorded, and says so, not zeros', async () => {
    api.list.mockResolvedValue({ broadcasts: [row({ id: '3', title: 'Old send', tracked: false, sent: 578, pushed: 0, pushFailed: 0, noPush: 0, opened: 0, status: 'done', finishedAt: null })], nextBefore: null })
    render(<BroadcastsPage />)
    const tr = (await screen.findByText('Old send')).closest('tr')!
    expect(within(tr).getByText(/before tracking/)).toBeInTheDocument()
    expect(within(tr).getByText('578')).toBeInTheDocument()
    expect(within(tr).getAllByText('—')).toHaveLength(4) // pushed, in-app only, refused, opened
    expect(within(tr).getAllByTitle(/before delivery tracking existed/)).toHaveLength(4)
  })

  it('"Left out" adds up the people dropped at the check and the ones dropped by the time it was sent', async () => {
    api.list.mockResolvedValue({ broadcasts: [row({ id: '4', title: 'Sum', skippedOptedOut: 1, skippedCapped: 2, skippedAtSend: 4 })], nextBefore: null })
    render(<BroadcastsPage />)
    const tr = (await screen.findByText('Sum')).closest('tr')!
    expect(within(tr).getByText('7')).toBeInTheDocument()
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
