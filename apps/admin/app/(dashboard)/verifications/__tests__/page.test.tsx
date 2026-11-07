// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReviewCase, ReviewListItem } from '@/lib/verification-api'

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), resolve: vi.fn(), challenges: vi.fn(), waive: vi.fn() }))
vi.mock('@/lib/verification-api', () => ({ verificationApi: api }))

import VerificationsPage from '../page'

const item = (id: string, over: Partial<ReviewListItem> = {}): ReviewListItem => ({
  id, driverId: `d${id}`, driverName: `Driver ${id}`, driverPhone: `+9199000000${id}`, kind: 'daily_selfie',
  decision: 'fail', decisionReason: 'LOW_SIMILARITY', similarity: 41, ocrText: null, priority: 2,
  reviewState: 'queued', createdAt: '2026-11-07T04:00:00Z', ...over,
})
const detail = (id: string, over: Partial<ReviewCase> = {}): ReviewCase => ({
  ...item(id), imageUrl: `https://img.test/${id}.jpg`, status: 'auto_passed', registeredPlate: 'OD33AW5615',
  referenceUrls: ['https://img.test/ref.jpg'], history: [{ id: 'h1', createdAt: '2026-11-06T04:00:00Z', decision: 'pass', similarity: 97, reviewState: 'none', status: 'passed' }],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue({ items: [item('1'), item('2', { decision: 'review', decisionReason: 'BORDERLINE_MATCH', similarity: 82, priority: 1 })], budget: 30 })
  api.get.mockImplementation((id: string) => Promise.resolve(
    id === '2' ? detail('2', { decision: 'review', decisionReason: 'BORDERLINE_MATCH', similarity: 82, priority: 1 }) : detail(id)))
  api.resolve.mockResolvedValue({ ok: true })
  api.challenges.mockResolvedValue([{ id: '77', driverId: 'd9', driverName: 'Open Driver', driverPhone: '+919900000009', reason: 'long_ride', openedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }])
  api.waive.mockResolvedValue({ ok: true })
})

describe('Verifications page', () => {
  it('lists cases with a text band chip and similarity, opens the first, and shows the budget chip', async () => {
    render(<VerificationsPage />)
    expect(await screen.findByText('Driver 1')).toBeTruthy()
    expect(screen.getByText('2 waiting / budget 30')).toBeTruthy()
    const list = within(screen.getByRole('listbox'))
    expect(list.getByText('FAIL')).toBeTruthy()
    expect(list.getByText('REVIEW')).toBeTruthy()
    expect(list.getByText('41%')).toBeTruthy()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('1'))
    expect(await screen.findByText(/doesn't look like the registered photo/)).toBeTruthy()
    expect(screen.getByAltText('Reference photo')).toBeTruthy()
  })

  it('"Looks fine" resolves the case and opens the next one', async () => {
    const user = userEvent.setup()
    render(<VerificationsPage />)
    await screen.findByText(/Similarity 41%/)
    await user.click(screen.getByRole('button', { name: /Looks fine/ }))
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith('1', { outcome: 'ok' }))
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('2'))
    expect(screen.queryByText('Driver 1')).toBeNull()
  })

  it('a mismatch without a note is not sent; with a note it is', async () => {
    const user = userEvent.setup()
    render(<VerificationsPage />)
    await screen.findByText(/Similarity 41%/)
    await user.click(screen.getByRole('button', { name: /Mismatch/ }))
    expect(api.resolve).not.toHaveBeenCalled()
    expect(await screen.findByText('Add a short note for a mismatch.')).toBeTruthy()
    await user.type(screen.getByLabelText(/Note/), 'different person')
    await user.click(screen.getByRole('button', { name: /Mismatch/ }))
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith('1', { outcome: 'mismatch', note: 'different person' }))
  })

  it('keyboard: J moves to the next case, O resolves as looks fine', async () => {
    const user = userEvent.setup()
    render(<VerificationsPage />)
    await screen.findByText(/Similarity 41%/)
    await user.keyboard('j')
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('2'))
    await screen.findByText(/Similarity 82%/)
    await user.keyboard('o')
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith('2', { outcome: 'ok' }))
  })

  it('typing o or m in the note box is not a shortcut', async () => {
    const user = userEvent.setup()
    render(<VerificationsPage />)
    await screen.findByText(/Similarity 41%/)
    await user.type(screen.getByLabelText(/Note/), 'mom')
    expect(api.resolve).not.toHaveBeenCalled()
  })

  it('a 409 shows the message and refreshes the list quietly', async () => {
    const user = userEvent.setup()
    api.resolve.mockRejectedValueOnce(Object.assign(new Error('x'), { isAxiosError: true, response: { data: { code: 'ALREADY_RESOLVED' } } }))
    render(<VerificationsPage />)
    await screen.findByText(/Similarity 41%/)
    await user.click(screen.getByRole('button', { name: /Looks fine/ }))
    expect(await screen.findByText('Another admin already resolved this case.')).toBeTruthy()
    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('shows "All caught up" when nothing is waiting and Retry when the list fails', async () => {
    api.list.mockResolvedValueOnce({ items: [], budget: 30 })
    const { unmount } = render(<VerificationsPage />)
    expect(await screen.findByText('All caught up')).toBeTruthy()
    unmount()

    api.list.mockRejectedValueOnce(new Error('down'))
    render(<VerificationsPage />)
    expect(await screen.findByText(/Couldn.t load the queue/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })

  it('a plate case shows the registered plate next to what was read, and no reference checkbox', async () => {
    api.list.mockResolvedValue({ items: [item('3', { kind: 'daily_plate', decision: 'review', decisionReason: 'PLATE_NEAR_MATCH', similarity: null })], budget: 30 })
    api.get.mockResolvedValue(detail('3', { kind: 'daily_plate', decision: 'review', decisionReason: 'PLATE_NEAR_MATCH', similarity: null, ocrText: 'OD33AW5616' }))
    render(<VerificationsPage />)
    expect(await screen.findByText('OD33AW5616')).toBeTruthy()
    expect(screen.getByText('OD33AW5615')).toBeTruthy()
    expect(screen.queryByLabelText(/Use this photo as a reference/)).toBeNull()
  })

  it('Open checks lists drivers waiting on a re-check; waiving takes two clicks and removes the row', async () => {
    const user = userEvent.setup()
    render(<VerificationsPage />)
    await screen.findByText('Driver 1')
    await user.click(screen.getByRole('tab', { name: 'Open checks' }))
    expect(await screen.findByText('Open Driver')).toBeTruthy()
    expect(screen.getByText(/After a long ride/)).toBeTruthy()
    expect(screen.getByText(/waiting 2 h/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Waive check' }))
    expect(api.waive).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm waive' }))
    await waitFor(() => expect(api.waive).toHaveBeenCalledWith('77'))
    await waitFor(() => expect(screen.queryByText('Open Driver')).toBeNull())
  })

  it('Open checks shows All caught up when nobody is waiting', async () => {
    const user = userEvent.setup()
    api.challenges.mockResolvedValueOnce([])
    render(<VerificationsPage />)
    await screen.findByText('Driver 1')
    await user.click(screen.getByRole('tab', { name: 'Open checks' }))
    expect(await screen.findByText(/No driver is waiting on a re-check/)).toBeTruthy()
  })
})
