// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DriverListItem, DriversResponse } from '@/lib/admin-api'

const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/admin-api', () => ({ adminDriverApi: api }))
vi.mock('@/lib/city-api', () => ({
  cityApi: { list: () => Promise.resolve([{ id: 1, name: 'Bhubaneswar' }, { id: 2, name: 'Cuttack' }]) },
}))
vi.mock('@/lib/vehicle-api', () => ({
  vehicleCategoryApi: { list: () => Promise.resolve([{ id: '7', display_name: 'Sedan' }]) },
}))

// Minimal URL-backed stand-in for next/navigation: replace() updates the params and re-renders subscribers.
const nav = vi.hoisted(() => ({
  params: new URLSearchParams(),
  listeners: new Set<() => void>(),
  push: vi.fn(),
  replace: vi.fn(),
}))
vi.mock('next/navigation', async () => {
  const React = await import('react')
  const router = {
    push: nav.push,
    replace: (url: string) => {
      nav.replace(url)
      nav.params = new URLSearchParams(url.split('?')[1] ?? '')
      nav.listeners.forEach(l => l())
    },
  }
  return {
    useRouter: () => router,
    usePathname: () => '/drivers',
    useSearchParams: () => React.useSyncExternalStore(
      cb => { nav.listeners.add(cb); return () => { nav.listeners.delete(cb) } },
      () => nav.params,
    ),
  }
})

// framer-motion resolves its own nested React under vitest; animation isn't under test here.
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

import DriversPage from '../page'

function driver(id: string, name: string, over: Partial<DriverListItem> = {}): DriverListItem {
  return {
    id, code: `DRV${id}`, phone: `+9190000000${id}`, full_name: name, email: null, status: 'active',
    onboarding_step: 'done', created_at: '2026-09-01T00:00:00Z', city: { id: '1', name: 'Bhubaneswar' },
    vehicle: { number_plate: `OD0${id}`, vehicle_name: 'Dzire', category: 'Sedan' }, docs_submitted: 5, docs_approved: 5, ...over,
  }
}
function resp(drivers: DriverListItem[], over: Partial<DriversResponse> = {}): DriversResponse {
  return {
    drivers,
    pagination: { total: drivers.length, page: 1, limit: 20, pages: 1 },
    summary: { total: drivers.length, active: drivers.length, pending_approval: 0, suspended: 0 },
    facets: { cities: { '1': 3, '2': 1, none: 0 }, categories: { '7': 4 } },
    ...over,
  }
}
const isBanner = (p: { status?: string }) => p.status === 'pending_approval'
const listCalls = () => api.list.mock.calls.map(c => c[0]).filter(p => !isBanner(p))

beforeEach(() => {
  api.list.mockReset()
  nav.replace.mockReset(); nav.push.mockReset()
  nav.params = new URLSearchParams()
})

describe('Drivers page filters', () => {
  it('renders rows, the City column and server-side summary cards', async () => {
    api.list.mockImplementation(async (p: { status?: string }) =>
      isBanner(p) ? resp([]) : resp([driver('1', 'Asha'), driver('2', 'Bikram', { city: null })], { summary: { total: 181, active: 16, pending_approval: 0, suspended: 0 } }))
    render(<DriversPage />)
    expect(await screen.findByText('Asha')).toBeInTheDocument()
    expect(screen.getByText('Bhubaneswar', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Not assigned')).toBeInTheDocument()
    expect(screen.getByText('181')).toBeInTheDocument() // summary total, not the 2 rows on screen
  })

  it('ticking a city writes it to the URL, shows a chip and refetches with that city', async () => {
    api.list.mockImplementation(async (p: { status?: string }) => isBanner(p) ? resp([]) : resp([driver('1', 'Asha')]))
    const user = userEvent.setup()
    render(<DriversPage />)
    await screen.findByText('Asha')
    await user.click(screen.getByRole('button', { name: 'City' }))
    await user.click(await screen.findByRole('checkbox', { name: /Cuttack/ }))
    expect(nav.replace).toHaveBeenLastCalledWith('/drivers?city=2')
    expect(await screen.findByText('City: Cuttack')).toBeInTheDocument()
    await waitFor(() => expect(listCalls().at(-1)).toMatchObject({ city: '2' }))
  })

  it('starts from filters already in the URL (Back / shared link)', async () => {
    nav.params = new URLSearchParams('city=1,none&vehicle=7')
    api.list.mockImplementation(async (p: { status?: string }) => isBanner(p) ? resp([]) : resp([driver('1', 'Asha')]))
    render(<DriversPage />)
    expect(await screen.findByText('City: Bhubaneswar')).toBeInTheDocument()
    expect(screen.getByText('City: Not assigned')).toBeInTheDocument()
    expect(screen.getByText('Vehicle: Sedan')).toBeInTheDocument()
    expect(listCalls()[0]).toMatchObject({ city: '1,none', vehicle: '7' })
  })

  it('ignores an older response that lands after a newer one', async () => {
    let resolveFirst!: (r: DriversResponse) => void
    let call = 0
    api.list.mockImplementation((p: { status?: string }) => {
      if (isBanner(p)) return Promise.resolve(resp([]))
      call += 1
      return call === 1 ? new Promise<DriversResponse>(r => { resolveFirst = r }) : Promise.resolve(resp([driver('2', 'Newer')]))
    })
    const user = userEvent.setup()
    render(<DriversPage />)
    await user.click(screen.getByRole('button', { name: 'City' }))
    await user.click(await screen.findByRole('checkbox', { name: /Cuttack/ }))
    expect(await screen.findByText('Newer')).toBeInTheDocument()
    await act(async () => { resolveFirst(resp([driver('1', 'Stale')])) })
    expect(screen.queryByText('Stale')).not.toBeInTheDocument()
    expect(screen.getByText('Newer')).toBeInTheDocument()
  })

  it('shows an inline error with Retry, never stale rows, when the request fails', async () => {
    let fail = true
    api.list.mockImplementation(async (p: { status?: string }) => {
      if (isBanner(p)) return resp([])
      if (fail) throw new Error('boom')
      return resp([driver('1', 'Recovered')])
    })
    const user = userEvent.setup()
    render(<DriversPage />)
    const alert = await screen.findByText("Couldn't load drivers.")
    expect(alert).toBeInTheDocument()
    fail = false
    await user.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Recovered')).toBeInTheDocument()
  })

  it('names the filters in the empty state and Clear filters resets the URL', async () => {
    nav.params = new URLSearchParams('city=2&vehicle=7')
    api.list.mockImplementation(async (p: { status?: string }) => isBanner(p) ? resp([]) : resp([]))
    const user = userEvent.setup()
    render(<DriversPage />)
    expect(await screen.findByText('No drivers in Cuttack with Sedan vehicles')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Clear filters' })
    await user.click(buttons[buttons.length - 1]!)
    expect(nav.replace).toHaveBeenLastCalledWith('/drivers')
  })

  it('a chip for a city missing from the list falls back to its id', async () => {
    nav.params = new URLSearchParams('city=99')
    api.list.mockImplementation(async (p: { status?: string }) => isBanner(p) ? resp([]) : resp([]))
    render(<DriversPage />)
    expect(await screen.findByText('City: City #99')).toBeInTheDocument()
  })

  it('the approval banner has its own request and lists pending drivers beyond the current page', async () => {
    nav.params = new URLSearchParams('city=1')
    api.list.mockImplementation(async (p: { status?: string }) =>
      isBanner(p) ? resp([driver('9', 'Pending Pat', { status: 'pending_approval' })]) : resp([driver('1', 'Asha')]))
    render(<DriversPage />)
    expect(await screen.findByText(/1 driver awaiting approval/)).toBeInTheDocument()
    expect(screen.getAllByText('Pending Pat').length).toBeGreaterThan(0)
    const bannerCall = api.list.mock.calls.map(c => c[0]).find(isBanner)
    expect(bannerCall).toMatchObject({ status: 'pending_approval', city: '1', limit: 50 })
  })

  it('shows an error with Retry when only the banner request fails', async () => {
    api.list.mockImplementation(async (p: { status?: string }) => { if (isBanner(p)) throw new Error('boom'); return resp([driver('1', 'Asha')]) })
    render(<DriversPage />)
    expect(await screen.findByText("Couldn't load drivers awaiting approval.")).toBeInTheDocument()
    expect(await screen.findByText('Asha')).toBeInTheDocument()
  })
})
