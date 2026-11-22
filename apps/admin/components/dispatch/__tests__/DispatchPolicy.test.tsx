// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const api = vi.hoisted(() => ({ policy: vi.fn(), savePolicy: vi.fn() }))
vi.mock('@/lib/dispatch-api', () => ({ dispatchApi: api }))
import DispatchPolicy from '../DispatchPolicy'

const POLICY = { lateCancelEnabled: false, lateCancelWindowMin: 60, feeMode: 'percent', feePercent: 10, feeCap: 100, feeFlat: 50, rescheduleMax: 3, searchGraceMin: 10 }
const LIMITS = Object.fromEntries(Object.keys(POLICY).map(k => [k, { min: 0, max: k === 'feePercent' ? 100 : 5000 }]))

beforeEach(() => {
  vi.clearAllMocks()
  api.policy.mockResolvedValue({ policy: POLICY, limits: LIMITS })
  api.savePolicy.mockImplementation(async (changes: object) => ({ ...POLICY, ...changes }))
})

const example = () => screen.getByTestId('fee-example')

describe('DispatchPolicy', () => {
  it('loads the saved rules and says there is no fee while the switch is off', async () => {
    render(<DispatchPolicy canEdit />)
    expect(await screen.findByText('Charge a fee for late cancellations')).toBeInTheDocument()
    expect(example()).toHaveTextContent(/^No fee/)
    expect(screen.getByLabelText('Late means within')).toBeDisabled() // inert until the fee is on
  })

  it('shows the fee on a real fare as soon as the switch goes on', async () => {
    const user = userEvent.setup()
    render(<DispatchPolicy canEdit />)
    await user.click(await screen.findByRole('switch'))
    expect(example()).toHaveTextContent('On a ₹1,850 fare')
    expect(example()).toHaveTextContent('costs ₹100')
    await user.click(screen.getByRole('radio', { name: 'Flat amount' }))
    expect(example()).toHaveTextContent('a flat ₹50')
  })

  it('needs a reason, then sends only the fields that changed', async () => {
    const user = userEvent.setup()
    render(<DispatchPolicy canEdit />)
    await user.click(await screen.findByRole('switch'))
    const save = screen.getByRole('button', { name: /Save changes/ })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Reason for this change'), 'Launch with a 10% fee')
    await user.click(save)
    expect(api.savePolicy).toHaveBeenCalledWith({ lateCancelEnabled: true }, 'Launch with a 10% fee')
    expect(await screen.findByText(/New bookings and cancellations use these rules now/)).toBeInTheDocument()
  })

  it('blocks a value outside the allowed range and says why', async () => {
    const user = userEvent.setup()
    render(<DispatchPolicy canEdit />)
    await screen.findByText('Charge a fee for late cancellations')
    await user.click(screen.getByRole('switch'))
    const pct = screen.getByLabelText('Percent of the fare')
    await user.clear(pct)
    await user.type(pct, '150')
    await user.type(screen.getByLabelText('Reason for this change'), 'Trying a big number')
    expect(screen.getByText(/percentage cannot be above 100/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Save changes/ })).toBeDisabled()
  })

  it('shows the server error and keeps the draft when saving fails', async () => {
    api.savePolicy.mockRejectedValue(new Error('x'))
    const user = userEvent.setup()
    render(<DispatchPolicy canEdit />)
    await user.click(await screen.findByRole('switch'))
    await user.type(screen.getByLabelText('Reason for this change'), 'Because the owner said so')
    await user.click(screen.getByRole('button', { name: /Save changes/ }))
    expect(await screen.findByText(/Could not save. Nothing was changed./)).toBeInTheDocument()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  })

  it('is read-only for a role that cannot change it', async () => {
    render(<DispatchPolicy canEdit={false} />)
    expect(await screen.findByText(/only a super admin can change them/)).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Save changes/ })).toBeNull()
  })

  it('offers Retry when the policy cannot be loaded', async () => {
    api.policy.mockRejectedValueOnce(new Error('x'))
    const user = userEvent.setup()
    render(<DispatchPolicy canEdit />)
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Charge a fee for late cancellations')).toBeInTheDocument())
  })
})
