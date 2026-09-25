// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, type AxiosResponse } from 'axios'
import type { SystemConfig } from '@/lib/system-config-api'

const api = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/system-config-api', () => ({ systemConfigApi: api }))

// framer-motion resolves its own nested copy of React under vitest (the duplicate-React trap noted in
// vitest.config.ts). Animation isn't what these tests cover, so render its components as plain elements.
vi.mock('framer-motion', async () => {
  const React = await import('react')
  const strip = ({ initial: _i, animate: _a, exit: _e, transition: _t, ...rest }: Record<string, unknown>) => rest
  const cache = new Map<string, unknown>() // one stable component per tag, or React remounts the tree every render
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

import SystemConfigPage from '../page'

const T0 = '2026-09-01T00:00:00.000Z'
function row(over: Partial<SystemConfig> & { id: string; key: string }): SystemConfig {
  return { value: '1', valueType: 'integer', description: null, isPublic: false, status: 'active', updatedAt: T0, min: null, max: null, ...over }
}
const seed = (): SystemConfig[] => [
  row({ id: '1', key: 'commission_percent', valueType: 'decimal', value: '15', min: 0, max: 50 }),
  row({ id: '2', key: 'razorpay_enabled', valueType: 'boolean', value: 'false' }),
  row({ id: '3', key: 'cashback_expiry_days', value: '30', min: 1, max: 3650 }),
  row({ id: '4', key: 'exotel_masking_enabled', valueType: 'boolean', value: 'false' }),
  row({ id: '5', key: 'brand_new_key', valueType: 'string', value: 'hello', description: 'A key nobody registered' }),
]

function conflict() {
  return new AxiosError('conflict', 'ERR_BAD_REQUEST', undefined, undefined,
    { status: 409, data: { code: 'CONFIG_CHANGED', error: 'changed' } } as AxiosResponse)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue(seed())
  Element.prototype.scrollIntoView = vi.fn()
  ;(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return [] }
  }
})

async function renderReady() {
  const user = userEvent.setup()
  render(<SystemConfigPage />)
  await screen.findByText('Platform commission')
  return user
}
const commission = () => screen.getByRole('textbox', { name: 'Platform commission' })

describe('System Config page', () => {
  it('groups settings under headings and keeps legacy keys collapsed; unknown keys still show under Other', async () => {
    await renderReady()
    expect(screen.getByRole('heading', { name: 'Payments & fees' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rewards & referrals' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Other' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Brand new key' })).toBeInTheDocument()
    expect(screen.queryByText('Exotel masked calling')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Show 1/ }))
    expect(screen.getByText('Exotel masked calling')).toBeInTheDocument()
  })

  it('validates inline from the API range and blocks review until fixed', async () => {
    const user = await renderReady()
    await user.clear(commission())
    await user.type(commission(), '1500')
    expect(screen.getByText('Must be between 0 and 50')).toBeInTheDocument()
    expect(commission()).toHaveAttribute('aria-invalid', 'true')
    const bar = screen.getByRole('region', { name: 'Unsaved changes' })
    expect(bar).toHaveTextContent('1 to fix')
    expect(within(bar).getByRole('button', { name: /Review/ })).toBeDisabled()
  })

  it('reviews old → new, focuses Cancel, requires acknowledgement for live-impact settings, then saves with the expected updatedAt', async () => {
    const user = await renderReady()
    api.update.mockResolvedValue(row({ id: '1', key: 'commission_percent', valueType: 'decimal', value: '20', updatedAt: '2026-09-25T10:00:00.000Z', min: 0, max: 50 }))

    await user.clear(commission())
    await user.type(commission(), '20')
    await user.click(screen.getByRole('button', { name: /Review/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Review 1 change' })).toBeInTheDocument()
    expect(within(dialog).getByText('15%')).toBeInTheDocument()
    expect(within(dialog).getByText('20%')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus() // Enter can't confirm by accident

    const apply = within(dialog).getByRole('button', { name: /^Apply/ })
    expect(apply).toBeDisabled()
    await user.click(within(dialog).getByRole('checkbox'))
    expect(apply).toBeEnabled()
    await user.click(apply)

    expect(api.update).toHaveBeenCalledWith('1', '20', T0) // optimistic-concurrency token = what we loaded
    expect(await screen.findByText('1 setting updated')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument())
    expect(commission()).toHaveValue('20')
  })

  it('a non-critical change needs no acknowledgement', async () => {
    const user = await renderReady()
    await user.clear(screen.getByRole('textbox', { name: 'Cashback expiry' }))
    await user.type(screen.getByRole('textbox', { name: 'Cashback expiry' }), '45')
    await user.click(screen.getByRole('button', { name: /Review/ }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /^Apply/ })).toBeEnabled()
  })

  it('switches are real switches with a name, and toggling queues a change', async () => {
    const user = await renderReady()
    const sw = screen.getByRole('switch', { name: 'Razorpay payments' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toHaveTextContent('1 unsaved change')
  })

  it('undo restores the saved value and clears the change', async () => {
    const user = await renderReady()
    await user.clear(commission())
    await user.type(commission(), '20')
    await user.click(screen.getByRole('button', { name: 'Undo edit to Platform commission' }))
    expect(commission()).toHaveValue('15')
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).not.toBeInTheDocument()
  })

  it('on a 409 conflict it keeps the admin’s edit, says what the value became, and never overwrites silently', async () => {
    const user = await renderReady()
    api.update.mockRejectedValueOnce(conflict())
    // someone else moved cashback_expiry_days to 45 while this admin was editing
    api.list.mockResolvedValueOnce(seed().map(c => c.id === '3' ? { ...c, value: '45', updatedAt: '2026-09-25T09:00:00.000Z' } : c))

    const expiry = screen.getByRole('textbox', { name: 'Cashback expiry' })
    await user.clear(expiry)
    await user.type(expiry, '60')
    await user.click(screen.getByRole('button', { name: /Review/ }))
    await user.click(await screen.findByRole('button', { name: /^Apply/ }))

    expect(await screen.findByText(/Someone else changed this to 45 days/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('1 setting wasn’t saved')
    expect(screen.getByRole('textbox', { name: 'Cashback expiry' })).toHaveValue('60') // edit kept

    // a deliberate second save now carries the fresh token
    api.update.mockResolvedValueOnce(row({ id: '3', key: 'cashback_expiry_days', value: '60', updatedAt: '2026-09-25T09:05:00.000Z', min: 1, max: 3650 }))
    await user.click(screen.getByRole('button', { name: /Review/ }))
    await user.click(await screen.findByRole('button', { name: /^Apply/ }))
    await waitFor(() => expect(api.update).toHaveBeenLastCalledWith('3', '60', '2026-09-25T09:00:00.000Z'))
  })

  it('search filters across groups, shows an empty state, and clears', async () => {
    const user = await renderReady()
    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'razorpay')
    expect(screen.getByText('Razorpay payments')).toBeInTheDocument()
    expect(screen.queryByText('Platform commission')).not.toBeInTheDocument()

    await user.clear(screen.getByRole('searchbox', { name: 'Search settings' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search settings' }), 'zzzz')
    expect(screen.getByText(/No settings match/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show all settings' }))
    expect(screen.getByText('Platform commission')).toBeInTheDocument()
  })

  it('shows a recoverable error state when loading fails', async () => {
    api.list.mockRejectedValueOnce(new Error('boom'))
    const user = userEvent.setup()
    render(<SystemConfigPage />)
    expect(await screen.findByText('Couldn’t load settings')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Try again/ }))
    expect(await screen.findByText('Platform commission')).toBeInTheDocument()
  })
})
