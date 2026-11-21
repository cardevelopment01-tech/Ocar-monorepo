// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PackageTier } from '@/lib/package-api'

// Value: protects=an admin sees the plans as drivers are charged them, is warned about a plan that is a worse deal than a cheaper one, cannot
// save a bad plan, hears the server's reason when a save is refused, and is asked before a plan is hidden from drivers; fails_when=a failed
// save disappears silently, a plan worth less than its price is submitted, or "Hide" happens without asking; why_new=the page was a one-row
// form with no edit, no preview and no feedback; seam=package-api mocked, framer-motion stubbed; no_claim=real HTTP or animation.

const api = vi.hoisted(() => ({ listTiers: vi.fn(), createTier: vi.fn(), updateTier: vi.fn() }))
vi.mock('@/lib/package-api', () => ({ packageApi: api }))

vi.mock('framer-motion', async () => {
  const React = await import('react')
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: Record<string, unknown>) => rest
  const cache = new Map<string, unknown>()
  const motion = new Proxy({}, {
    get: (_target, tag: string) => {
      if (!cache.has(tag)) {
        const C = React.forwardRef((props: Record<string, unknown>, ref) => React.createElement(tag, { ...strip(props), ref }))
        C.displayName = `motion.${tag}`
        cache.set(tag, C)
      }
      return cache.get(tag)
    },
  })
  return { motion, AnimatePresence: ({ children }: { children: React.ReactNode }) => children, useReducedMotion: () => false }
})

import PackageTiersPage from '../page'

let id = 0
function tier(price: number, value: number, over: Partial<PackageTier> = {}): PackageTier {
  const gst = Math.round(price * 18) / 100
  return {
    id: ++id, label: `Plan ${price}`, price: price.toFixed(2), threshold_value: value.toFixed(2), is_active: true, vehicle_group: 'cab', validity_days: 365,
    gst_percent: 18, gst_amount: gst.toFixed(2), total_amount: (price + gst).toFixed(2), created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', ...over,
  }
}
const sheet = () => [tier(40, 550), tier(70, 1050), tier(250, 5500), tier(500, 10500), tier(800, 20000)]

beforeEach(() => {
  vi.clearAllMocks()
  id = 0
  api.listTiers.mockResolvedValue(sheet())
  api.createTier.mockResolvedValue({})
  api.updateTier.mockResolvedValue({})
})

async function ready() {
  render(<PackageTiersPage />)
  await screen.findByText('Plan 40')
}

describe('Ride credit plans page', () => {
  it('shows each plan as the driver is charged: total, the price and GST it is made of, and the value per rupee', async () => {
    await ready()
    const row = screen.getByText('Plan 40').closest('tr')!
    expect(within(row).getByText('₹47.20')).toBeInTheDocument()
    expect(within(row).getByText(/₹40\.00 \+ ₹7\.20 GST \(18%\)/)).toBeInTheDocument()
    expect(within(row).getByText('₹550')).toBeInTheDocument()
    expect(within(row).getByText('13.8×')).toBeInTheDocument()
    expect(screen.getByText('5 of 5')).toBeInTheDocument()
    expect(screen.getByText('18%')).toBeInTheDocument()
  })

  it('flags the plan that gives less per rupee than a cheaper one (the ₹500 plan, 21× against 22×) and no other', async () => {
    await ready()
    expect(screen.getAllByText(/Lower than a cheaper plan/)).toHaveLength(1)
    expect(within(screen.getByText('Plan 500').closest('tr')!).getByText(/Lower than a cheaper plan/)).toBeInTheDocument()
  })

  it('keeps cabs and autos apart and explains an empty group', async () => {
    await ready()
    await userEvent.click(screen.getByRole('tab', { name: /Autos/ }))
    expect(screen.queryByText('Plan 40')).not.toBeInTheDocument()
    expect(screen.getByText(/No plans for autos yet/)).toBeInTheDocument()
  })

  it('says so when the plans cannot be loaded, and retries', async () => {
    api.listTiers.mockRejectedValueOnce(new Error('boom'))
    render(<PackageTiersPage />)
    expect(await screen.findByText('Could not load the plans.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByText('Plan 40')).toBeInTheDocument()
  })
})

describe('Add a plan', () => {
  async function openAdd() {
    await ready()
    await userEvent.click(screen.getByRole('button', { name: /Add plan/ }))
    return screen.findByRole('dialog', {}, { timeout: 2000 }).catch(() => null)
  }
  const field = (name: RegExp) => screen.getByLabelText(name)

  it('previews what drivers will see and pay as the admin types', async () => {
    await openAdd()
    expect(screen.getByTestId('driver-preview-empty')).toBeInTheDocument()
    await userEvent.type(field(/Price \(₹\)/), '40')
    await userEvent.type(field(/Ride value/), '550')
    const preview = screen.getByTestId('driver-preview')
    expect(within(preview).getByText('₹550')).toBeInTheDocument()
    expect(within(preview).getByText('₹47.20')).toBeInTheDocument()
    expect(within(preview).getByText('₹7.20')).toBeInTheDocument()
    expect(within(preview).getByText(/13\.8× ride credit/)).toBeInTheDocument()
  })

  it('does not cheer for a plan worth less than its price: the preview says so', async () => {
    await openAdd()
    await userEvent.type(field(/Price \(₹\)/), '600')
    await userEvent.type(field(/Ride value/), '550')
    expect(screen.getByTestId('preview-worth-less')).toHaveTextContent(/Worth less than its price/)
    expect(within(screen.getByTestId('driver-preview')).queryByText(/ride credit for every ₹1 of plan price/)).not.toBeInTheDocument()
  })

  it('refuses a ride value below the price and sends nothing', async () => {
    await openAdd()
    await userEvent.type(field(/Plan name/), 'Oops')
    await userEvent.type(field(/Price \(₹\)/), '600')
    await userEvent.type(field(/Ride value/), '550')
    // (the "How plans work" guide mentions the same rule, so check the field itself, not just the words)
    await waitFor(() => expect(field(/Ride value/)).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByRole('alert')).toHaveTextContent(/must be at least the price/)
    await userEvent.click(screen.getAllByRole('button', { name: 'Add plan' }).at(-1)!)
    expect(api.createTier).not.toHaveBeenCalled()
  })

  it('says what is missing when saved empty', async () => {
    await openAdd()
    await userEvent.click(screen.getAllByRole('button', { name: 'Add plan' }).at(-1)!)
    expect(await screen.findByText('Give the plan a name.')).toBeInTheDocument()
    expect(screen.getByText('Enter a price above zero.')).toBeInTheDocument()
    expect(api.createTier).not.toHaveBeenCalled()
  })

  it('creates the plan with numbers, closes, confirms, and reloads the list', async () => {
    await openAdd()
    await userEvent.type(field(/Plan name/), '  Weekly  ')
    await userEvent.type(field(/Price \(₹\)/), '30')
    await userEvent.type(field(/Ride value/), '1000')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add plan' }).at(-1)!)
    await waitFor(() => expect(api.createTier).toHaveBeenCalledWith({ label: 'Weekly', price: 30, thresholdValue: 1000, vehicleGroup: 'cab', validityDays: 365 }))
    expect(await screen.findByText('Plan added')).toBeInTheDocument()
    expect(api.listTiers).toHaveBeenCalledTimes(2)
  })

  it('shows the server’s reason when it refuses the save, and keeps the form open', async () => {
    api.createTier.mockRejectedValueOnce({ response: { data: { error: 'An active plan with the same price and ride value already exists for these drivers.' } } })
    await openAdd()
    await userEvent.type(field(/Plan name/), 'Dupe')
    await userEvent.type(field(/Price \(₹\)/), '30')
    await userEvent.type(field(/Ride value/), '1000')
    await userEvent.click(screen.getAllByRole('button', { name: 'Add plan' }).at(-1)!)
    expect(await screen.findByText(/already exists for these drivers/)).toBeInTheDocument()
    expect(field(/Plan name/)).toHaveValue('Dupe')
  })

  it('warns, without blocking, about a plan that gives less per rupee than a cheaper one', async () => {
    api.listTiers.mockResolvedValue(sheet().slice(0, 3))
    await openAdd()
    await userEvent.type(field(/Price \(₹\)/), '500')
    await userEvent.type(field(/Ride value/), '10500')
    expect(await screen.findByText(/less than the ₹250 plan/)).toBeInTheDocument()
  })
})

describe('Edit and switch off', () => {
  it('opens a plan with its values, says edits apply to new purchases only, and saves the change', async () => {
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Plan 40' }))
    expect(screen.getByLabelText(/Plan name/)).toHaveValue('Plan 40')
    expect(screen.getByText(/Changes apply to/)).toBeInTheDocument()
    const price = screen.getByLabelText(/Price \(₹\)/)
    await userEvent.clear(price)
    await userEvent.type(price, '45')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateTier).toHaveBeenCalledWith(1, { label: 'Plan 40', price: 45, thresholdValue: 550, vehicleGroup: 'cab', validityDays: 365 }))
    expect(await screen.findByText('Plan updated')).toBeInTheDocument()
  })

  it('asks before hiding a plan, and does nothing if the admin backs out', async () => {
    await ready()
    await userEvent.click(screen.getByRole('switch', { name: /Plan 40 is live/ }))
    expect(await screen.findByText(/Hide “Plan 40” from drivers\?/)).toBeInTheDocument()
    expect(api.updateTier).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.updateTier).not.toHaveBeenCalled()
  })

  it('hides the plan once confirmed, and switches one back on without asking', async () => {
    const live = tier(40, 550), off = tier(70, 1050, { is_active: false })
    api.listTiers.mockResolvedValue([live, off])
    render(<PackageTiersPage />)
    await screen.findByText('Plan 40')
    await userEvent.click(screen.getByRole('switch', { name: /Plan 40 is live/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Hide plan' }))
    await waitFor(() => expect(api.updateTier).toHaveBeenCalledWith(live.id, { isActive: false }))
    await userEvent.click(screen.getByRole('switch', { name: /Plan 70 is live/ }))
    await waitFor(() => expect(api.updateTier).toHaveBeenCalledWith(off.id, { isActive: true }))
  })

  it('tells the admin when a switch fails instead of failing silently', async () => {
    api.updateTier.mockRejectedValueOnce(new Error('network'))
    api.listTiers.mockResolvedValue([tier(70, 1050, { is_active: false })])
    render(<PackageTiersPage />)
    await screen.findByText('Plan 70')
    await userEvent.click(screen.getByRole('switch', { name: /Plan 70 is live/ }))
    expect(await screen.findByText('Could not change the plan. Please try again.')).toBeInTheDocument()
  })
})
