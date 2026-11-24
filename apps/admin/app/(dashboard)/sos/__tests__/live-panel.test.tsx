// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { SosDetail } from '@/lib/safety-api'

const api = vi.hoisted(() => ({ getSosDetail: vi.fn() }))
vi.mock('@/lib/safety-api', () => ({ safetyApi: api }))

// A tiny socket: records what the panel emits and lets the test fire server events.
const sock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...a: never[]) => void>>()
  return {
    emitted: [] as [string, unknown][],
    handlers,
    emit(e: string, p: unknown) { this.emitted.push([e, p]) },
    on(e: string, fn: (...a: never[]) => void) { (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(fn) },
    off(e: string, fn: (...a: never[]) => void) { handlers.get(e)?.delete(fn) },
    fire(e: string, p: unknown) { handlers.get(e)?.forEach(fn => (fn as (x: unknown) => void)(p)) },
  }
})
vi.mock('@/lib/socket', () => ({ getAdminSocket: () => sock }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))
vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Polyline: ({ path }: { path: unknown[] }) => <div data-testid="polyline" data-n={path.length} />,
  AdvancedMarker: ({ position, children }: { position: { lat: number; lng: number }; children: React.ReactNode }) => <div data-lat={position.lat} data-lng={position.lng}>{children}</div>,
  useMap: () => null,
}))

import SosLivePanel from '../SosLivePanel'

const iso = (secsAgo: number) => new Date(Date.now() - secsAgo * 1000).toISOString()
function detail(id: string, rideId: string, name: string, lat: number, over: Partial<SosDetail> = {}): SosDetail {
  return {
    id, ride_id: rideId, severity: 'medium', status: 'triggered', triggered_by_user: '1', triggered_by_driver: null,
    user_name: name, user_phone: '+91980000000' + id, driver_name: 'Driver ' + id, driver_phone: null,
    origin_address: 'A', destination_address: 'B', location_lat: String(lat), location_lng: '85.8', notes: null,
    acknowledged_by: null, acknowledged_by_email: null, acknowledged_at: null, resolved_by_email: null, resolved_at: null,
    resolution_note: null, created_at: iso(30), ride_status: 'in_progress', pickup_lat: null, pickup_lng: null,
    rider_name: name, rider_phone: '+91980000000' + id, number_plate: null, vehicle_name: null, previous_alerts: 0,
    trail: [{ lat, lng: 85.8, recorded_at: iso(30), speed_kmph: 30 }], ...over,
  } as SosDetail
}
const props = (id: string) => ({ id, busy: false, onClose: vi.fn(), onAcknowledge: vi.fn(), onResolve: vi.fn() })
const carAt = () => document.querySelector('[title="Car"]')!.parentElement!
const fire = (e: unknown) => act(() => { sock.fire('driver:location', e) })
const joins = () => sock.emitted.filter(([e]) => e === 'join:ride' || e === 'leave:ride').map(([e, p]) => `${e}:${p}`)
const title = (name: string) => screen.findByText(name, { selector: 'p.font-bold' })

beforeEach(() => {
  vi.clearAllMocks()
  sock.emitted.length = 0
  sock.handlers.clear()
})

describe('SosLivePanel real time', () => {
  it("joins the alert's ride room once it is known, and leaves it on close", async () => {
    api.getSosDetail.mockResolvedValue(detail('1', '11', 'Asha', 20.3))
    const { unmount } = render(<SosLivePanel {...props('1')} />)
    await title('Asha')
    expect(joins()).toEqual(['join:ride:11'])
    unmount()
    expect(joins()).toEqual(['join:ride:11', 'leave:ride:11'])
    expect(sock.handlers.get('driver:location')?.size ?? 0).toBe(0)
  })

  it('moves the car and shows "Live" the moment a position arrives, without waiting for a refresh', async () => {
    api.getSosDetail.mockResolvedValue(detail('1', '11', 'Asha', 20.3))
    render(<SosLivePanel {...props('1')} />)
    await title('Asha')
    expect(carAt().getAttribute('data-lat')).toBe('20.3')
    fire({ rideId: '11', lat: 20.31, lng: 85.81, speed_kmph: 44 })
    expect(carAt().getAttribute('data-lat')).toBe('20.31')
    expect(screen.getByTestId('signal').textContent).toContain('Live · updated 0s ago')
    expect(screen.getByTestId('polyline').getAttribute('data-n')).toBe('2')
  })

  it('ignores an event for a different ride, and malformed ones', async () => {
    api.getSosDetail.mockResolvedValue(detail('1', '11', 'Asha', 20.3))
    render(<SosLivePanel {...props('1')} />)
    await title('Asha')
    fire({ rideId: '99', lat: 25, lng: 80 })
    fire({ lat: 25, lng: 80 })
    fire({ rideId: '11', lat: 'x', lng: 80 })
    expect(carAt().getAttribute('data-lat')).toBe('20.3')
  })

  it('joins again after a reconnect, because a new connection starts with no rooms', async () => {
    api.getSosDetail.mockResolvedValue(detail('1', '11', 'Asha', 20.3))
    render(<SosLivePanel {...props('1')} />)
    await title('Asha')
    act(() => { sock.fire('connect', undefined) })
    expect(joins()).toEqual(['join:ride:11', 'join:ride:11'])
  })

  it('does not listen at all for an alert that is already closed', async () => {
    api.getSosDetail.mockResolvedValue(detail('1', '11', 'Asha', 20.3, { status: 'resolved' }))
    render(<SosLivePanel {...props('1')} />)
    await title('Asha')
    expect(joins()).toEqual([])
    expect(sock.handlers.get('driver:location')?.size ?? 0).toBe(0)
  })
})

describe('SosLivePanel rapid switching', () => {
  it('shows only the alert it ends on, even when answers and events from the one it left arrive late', async () => {
    const late: Record<string, (d: SosDetail) => void> = {}
    // alert 1's first answer is slow; alert 2 answers at once; alert 1's second request answers at once.
    let firstOfOne = true
    api.getSosDetail.mockImplementation((id: string) => {
      if (id === '2') return Promise.resolve(detail('2', '22', 'Bikash', 21.0))
      if (firstOfOne) { firstOfOne = false; return new Promise<SosDetail>(res => { late['1'] = res }) }
      return Promise.resolve(detail('1', '11', 'Asha', 20.3))
    })
    const { rerender } = render(<SosLivePanel {...props('1')} />)
    rerender(<SosLivePanel {...props('2')} />)
    await title('Bikash')
    expect(joins()).toEqual(['join:ride:22'])

    rerender(<SosLivePanel {...props('1')} />)
    await title('Asha')
    expect(joins()).toEqual(['join:ride:22', 'leave:ride:22', 'join:ride:11'])

    // The slow first answer for alert 1, and a position for the ride just left, both land now.
    await act(async () => { late['1']!(detail('1', '11', 'Asha STALE', 99)) })
    fire({ rideId: '22', lat: 22, lng: 86 })
    expect(screen.queryByText('Asha STALE')).toBeNull()
    expect(carAt().getAttribute('data-lat')).toBe('20.3')

    // ...while a position for the ride on screen is drawn.
    fire({ rideId: '11', lat: 20.35, lng: 85.9 })
    expect(carAt().getAttribute('data-lat')).toBe('20.35')
  })

  it('survives twenty switches in a row: one room joined at the end, nothing left behind', async () => {
    api.getSosDetail.mockImplementation((id: string) => Promise.resolve(detail(id, String(Number(id) * 11), 'Person ' + id, 20 + Number(id) / 100)))
    const { rerender, unmount } = render(<SosLivePanel {...props('1')} />)
    for (let i = 2; i <= 20; i++) rerender(<SosLivePanel {...props(String(i))} />)
    await title('Person 20')
    const balance = () => joins().filter(j => j.startsWith('join')).length - joins().filter(j => j.startsWith('leave')).length
    await waitFor(() => expect(balance()).toBe(1))
    expect(joins().at(-1)).toBe('join:ride:220')
    expect(sock.handlers.get('driver:location')?.size).toBe(1)
    unmount()
    expect(balance()).toBe(0)
    expect(sock.handlers.get('driver:location')?.size ?? 0).toBe(0)
  })
})
