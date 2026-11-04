// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { META, row, detail } from '@/components/offers/__tests__/helpers'

// Value: protects=the offers screens show server truth (status tabs with counts, budget used, plain reasons), finance
// can look but not touch, the form is built from the server catalog and fails closed, terms edits make a new version
// while name/budget edits do not, and nothing is saved from an invalid form; fails_when=any of those drift;
// why_new=PR3 UI; seam=none; no_claim=real layout/visual QA and the API (mocked).

const api = vi.hoisted(() => ({
  meta: vi.fn(), list: vi.fn(), get: vi.fn(), create: vi.fn(), patch: vi.fn(), createVersion: vi.fn(),
  previewDraft: vi.fn(), stats: vi.fn(), redemptions: vi.fn(),
}))
vi.mock('@/lib/offers-api', () => ({ offersApi: api }))
vi.mock('@/lib/vehicle-api', () => ({ vehicleCategoryApi: { list: vi.fn().mockResolvedValue([{ id: '1', display_name: 'Sedan' }]) } }))
vi.mock('@/lib/city-api', () => ({ cityApi: { list: vi.fn().mockResolvedValue([{ id: 1, name: 'Bhubaneswar' }, { id: 2, name: 'Puri' }]) } }))
const nav = vi.hoisted(() => ({ push: vi.fn(), id: '5' }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push }), useParams: () => ({ id: nav.id }) }))
const auth = vi.hoisted(() => ({ role: 'ops_admin' as string }))
vi.mock('@/lib/auth-context', () => ({ useAdminAuth: () => ({ admin: { role: auth.role } }) }))
vi.mock('next/link', async () => {
  const React = await import('react')
  return { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...rest }, children) }
})
vi.mock('framer-motion', async () => (await import('@/components/offers/__tests__/framer-stub')).framerStub())

import OffersPage from '../page'
import NewOfferPage from '../new/page'
import OfferDetailPage from '../[id]/page'

beforeEach(() => {
  vi.clearAllMocks()
  auth.role = 'ops_admin'
  nav.id = '5'
  api.meta.mockResolvedValue(META)
  api.list.mockResolvedValue({ offers: [row({ id: '1' }), row({ id: '2', name: 'Weekend', code: null, kind: 'auto', status: 'draft', budget_total: null, budget_spent: '0', summary: '10% off, Sat/Sun' })], counts: { active: 1, draft: 1, ended: 3 } })
  api.previewDraft.mockResolvedValue({ summary: '10% off' })
  api.stats.mockResolvedValue({ offerId: '5', redemptions: { consumed: 4, reserved: 1 }, discountGiven: 410, cashbackGiven: 0, budgetTotal: 500, budgetSpent: 410 })
  api.get.mockResolvedValue(detail())
  api.redemptions.mockResolvedValue([])
  api.create.mockResolvedValue(detail())
  api.patch.mockResolvedValue(detail())
  api.createVersion.mockResolvedValue(detail())
  Element.prototype.scrollIntoView = vi.fn()
})

describe('Offers list', () => {
  it('shows the status tabs with counts, each row with its summary, and the budget used', async () => {
    render(<OffersPage />)
    expect(await screen.findByText('Ten off')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^All\s*5$/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Live\s*1/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Ended\s*3/ })).toBeInTheDocument()
    expect(screen.getByText('10% off, Sat/Sun')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Budget used 82%' })).toHaveAttribute('aria-valuenow', '82')
    expect(screen.getByText('No budget set')).toBeInTheDocument()
    expect(screen.getByText('Applied automatically')).toBeInTheDocument()
  })

  it('clicking a tab asks the server for that status', async () => {
    const user = userEvent.setup()
    render(<OffersPage />)
    await screen.findByText('Ten off')
    await user.click(screen.getByRole('tab', { name: /Paused/ }))
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'paused' })))
  })

  it('finance can read the list but gets no New offer button; ops does', async () => {
    auth.role = 'finance_admin'
    const { unmount } = render(<OffersPage />)
    await screen.findByText('Ten off')
    expect(screen.queryByRole('link', { name: /New offer/ })).not.toBeInTheDocument()
    unmount()
    auth.role = 'ops_admin'
    render(<OffersPage />)
    expect(await screen.findByRole('link', { name: /New offer/ })).toHaveAttribute('href', '/offers/new')
  })

  it('shows a plain error and an empty state', async () => {
    api.list.mockRejectedValueOnce(new Error('x'))
    const { unmount } = render(<OffersPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load offers.')
    unmount()
    api.list.mockResolvedValue({ offers: [], counts: {} })
    render(<OffersPage />)
    expect(await screen.findByText(/No offers yet/)).toBeInTheDocument()
  })
})

describe('New offer', () => {
  it('builds the conditions from the server catalog: one group each for Who, Where and What, and a kind no group names under Other', async () => {
    api.meta.mockResolvedValue({ ...META, rules: [...META.rules, { kind: 'moon_phase', label: 'Moon phase', fields: [] }] })
    render(<NewOfferPage />)
    await screen.findByRole('heading', { name: 'Who' })
    expect(screen.getByRole('heading', { name: 'Where' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'What' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'When' })).not.toBeInTheDocument() // the server did not offer a schedule rule
    expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument()
    expect(within(screen.getByLabelText('Add a other condition')).getByRole('option', { name: 'Moon phase' })).toBeInTheDocument()
  })

  it('fails closed when the catalog cannot load: no form, a plain error', async () => {
    api.meta.mockRejectedValue(new Error('down'))
    render(<NewOfferPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not load the offer options/)
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('a role that cannot create sees why instead of a form', async () => {
    auth.role = 'finance_admin'
    render(<NewOfferPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent(/can view offers but not create/)
  })

  it('does not save an invalid form: it lists what to fix and calls nothing', async () => {
    const user = userEvent.setup()
    render(<NewOfferPage />)
    await screen.findByLabelText('Name')
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Give the offer a name.')
    expect(alert).toHaveTextContent('A code offer needs a code.')
    expect(alert).toHaveTextContent('Enter the percent off.')
    expect(api.create).not.toHaveBeenCalled()
  })

  it('a template fills the form, the live sentence comes from the server, and Publish sends the real payload then opens the offer', async () => {
    const user = userEvent.setup()
    api.previewDraft.mockResolvedValue({ summary: '10% off, max ₹50, new users' })
    render(<NewOfferPage />)
    await screen.findByLabelText('Name')
    await user.click(screen.getByRole('button', { name: /First ride discount/ }))
    expect(screen.getByLabelText('Name')).toHaveValue('First ride discount')
    expect(await screen.findByText('10% off, max ₹50, new users')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Publish now' }))
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1))
    expect(api.create.mock.calls[0]![0]).toMatchObject({
      name: 'First ride discount', kind: 'auto', status: 'active', rules: [{ kind: 'new_user' }], benefit: { type: 'percent_off', percent: 10, maxDiscount: 50 },
    })
    expect(api.create.mock.calls[0]![0]).not.toHaveProperty('code')
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/offers/5'))
  })

  it('shows the server message when saving fails, and keeps the form', async () => {
    const user = userEvent.setup()
    api.create.mockRejectedValue(Object.assign(new Error('x'), { isAxiosError: true, response: { status: 409, data: { error: 'That code is already used', code: 'CODE_TAKEN' } } }))
    render(<NewOfferPage />)
    await screen.findByLabelText('Name')
    await user.click(screen.getByRole('button', { name: /Flat ₹ off/ }))
    await user.type(screen.getByLabelText('Code'), 'dup50')
    await user.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(await screen.findByText('That code is already used')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Flat discount')
  })

  it('warns about a missing budget and end date in the checklist without blocking', async () => {
    const user = userEvent.setup()
    render(<NewOfferPage />)
    await screen.findByLabelText('Name')
    expect(screen.getByText(/No budget set. The offer can give away discounts without a limit/)).toBeInTheDocument()
    expect(screen.getByText(/No end date/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Budget (₹)'), '5000')
    expect(screen.getByText('Budget is ₹5,000.')).toBeInTheDocument()
  })

  it('does not list cashback while the server says it is off', async () => {
    render(<NewOfferPage />)
    const type = await screen.findByLabelText('Type')
    expect(within(type).queryByRole('option', { name: 'Percentage cashback' })).not.toBeInTheDocument()
    expect(within(type).getByRole('option', { name: 'Flat amount off' })).toBeInTheDocument()
  })
})

describe('Offer detail', () => {
  it('shows what it has given away and the budget, and lists versions with the current one first', async () => {
    const user = userEvent.setup()
    render(<OfferDetailPage />)
    expect(await screen.findByRole('heading', { name: 'Ten off' })).toBeInTheDocument()
    expect(screen.getByText('₹410')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Budget used 82%' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    const rowsText = screen.getAllByRole('row').map((r) => r.textContent ?? '')
    expect(rowsText[1]).toMatch(/Current.*10% off/)
    expect(rowsText[2]).toMatch(/Earlier \(1\).*5% off/)
  })

  it('pausing asks first, then changes only the status', async () => {
    const user = userEvent.setup()
    render(<OfferDetailPage />)
    await screen.findByRole('heading', { name: 'Ten off' })
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Rides already booked keep it')
    expect(api.patch).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('5', { status: 'paused' }))
  })

  it('finance sees no status buttons, and an ended offer has none for anyone', async () => {
    auth.role = 'finance_admin'
    const { unmount } = render(<OfferDetailPage />)
    await screen.findByRole('heading', { name: 'Ten off' })
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument()
    unmount()
    auth.role = 'ops_admin'
    api.get.mockResolvedValue(detail({ status: 'ended' }))
    render(<OfferDetailPage />)
    await screen.findByRole('heading', { name: 'Ten off' })
    expect(screen.queryByRole('button', { name: /Pause|End|Resume|Publish/ })).not.toBeInTheDocument()
  })

  it('changing the percent saves a NEW version; changing only the name or budget edits in place', async () => {
    const user = userEvent.setup()
    render(<OfferDetailPage />)
    await screen.findByRole('heading', { name: 'Ten off' })
    await user.click(screen.getByRole('tab', { name: 'Terms' }))
    const percent = await screen.findByLabelText('Percent')
    await user.clear(percent)
    await user.type(percent, '12')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.createVersion).toHaveBeenCalledTimes(1))
    expect(api.createVersion).toHaveBeenCalledWith('5', expect.objectContaining({ benefit: { type: 'percent_off', percent: 12, maxDiscount: 50 } }))
    expect(await screen.findByText(/Changes apply to new bookings only/, { selector: '[role="status"]' })).toBeInTheDocument()

    vi.clearAllMocks()
    api.get.mockResolvedValue(detail()); api.stats.mockResolvedValue({ offerId: '5', redemptions: {}, discountGiven: 0, cashbackGiven: 0, budgetTotal: 500, budgetSpent: 410 })
    api.meta.mockResolvedValue(META); api.previewDraft.mockResolvedValue({ summary: 'x' })
    const name = screen.getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'Ten off, renamed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('5', { name: 'Ten off, renamed' }))
    expect(api.createVersion).not.toHaveBeenCalled()
  })

  it('redemptions: filters go to the server, empty states differ, and CSV needs rows', async () => {
    const user = userEvent.setup()
    render(<OfferDetailPage />)
    await screen.findByRole('heading', { name: 'Ten off' })
    await user.click(screen.getByRole('tab', { name: 'Redemptions' }))
    expect(await screen.findByText('No one has used this offer yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download CSV/ })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Status'), 'consumed')
    await waitFor(() => expect(api.redemptions).toHaveBeenLastCalledWith('5', expect.objectContaining({ status: 'consumed' })))
    expect(await screen.findByText('No redemptions match these filters.')).toBeInTheDocument()
  })

  it('redemptions: shows rows in plain words', async () => {
    const user = userEvent.setup()
    api.redemptions.mockResolvedValue([{ id: '1', user_id: '3', ride_id: '77', status: 'released', discount_amount: '40.00', cashback_amount: '0.00', reserved_at: '2026-11-03T10:00:00Z', consumed_at: null, released_at: '2026-11-03T10:05:00Z', reason: 'ride cancelled' }])
    render(<OfferDetailPage />)
    await screen.findByRole('heading', { name: 'Ten off' })
    await user.click(screen.getByRole('tab', { name: 'Redemptions' }))
    const table = within(await screen.findByRole('table'))
    expect(await table.findByText('Given back')).toBeInTheDocument()
    expect(table.getByText('ride cancelled')).toBeInTheDocument()
    expect(table.getByText('₹40')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download CSV/ })).toBeEnabled()
  })
})
