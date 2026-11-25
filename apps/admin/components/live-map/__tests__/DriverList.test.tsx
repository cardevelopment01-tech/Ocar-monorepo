// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DriverList } from '../DriverList'
import type { ActiveDriverSession } from '@/lib/admin-api'
import { stageCounts, visibleDrivers } from '@/lib/live-map-model'

const NOW = Date.parse('2026-11-25T10:00:00Z')
const fresh = new Date(NOW - 10_000).toISOString()
const old = new Date(NOW - 20 * 60_000).toISOString()

const mk = (over: Partial<ActiveDriverSession>): ActiveDriverSession => ({
  session_id: '1', driver_id: '1', driver_name: 'Asha', driver_phone: '+919811100101', driver_code: 'D1', session_status: 'online',
  lat: 20.3, lng: 85.8, heading: 0, speed_kmph: 0, location_updated_at: fresh, ride_id: null, ride_status: null, rider_name: null,
  origin_address: null, destination_address: null, origin_lat: null, origin_lng: null, dest_lat: null, dest_lng: null,
  vehicle_category: null, vehicle_name: null, number_plate: 'OD02AB1101', ...over,
})

function setup(drivers: ActiveDriverSession[], over: Partial<Parameters<typeof DriverList>[0]> = {}) {
  const props = {
    rows: visibleDrivers(drivers, '', 'all', NOW), total: drivers.length, counts: stageCounts(drivers, NOW),
    query: '', onQuery: vi.fn(), filter: 'all' as const, onFilter: vi.fn(), selectedId: null, onSelect: vi.fn(), nowMs: NOW, ...over,
  }
  render(<DriverList {...props} />)
  return props
}

describe('DriverList', () => {
  const silent = mk({ driver_id: '2', driver_name: 'Tapas Ray', session_status: 'on_trip', ride_status: 'in_progress', ride_id: '1212', location_updated_at: old })
  const idle = mk({ driver_id: '1', driver_name: 'Asha' })

  it('lists drivers with the stage and, for a silent driver, how long ago they were last seen', () => {
    setup([idle, silent])
    expect(screen.getByText('Tapas Ray')).toBeTruthy()
    expect(screen.getByText(/No location · last seen 20m ago · ride 1212/)).toBeTruthy()
    expect(screen.getByText(/Idle · OD02AB1101/)).toBeTruthy()
  })

  it('shows a count on each stage chip', () => {
    setup([idle, silent])
    expect(screen.getByRole('button', { name: /No location 1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Idle 1/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /All 2/ })).toBeTruthy()
  })

  it('selects a driver when its row is clicked', async () => {
    const p = setup([idle, silent])
    await userEvent.click(screen.getByText('Tapas Ray'))
    expect(p.onSelect).toHaveBeenCalledWith('2')
  })

  it('a stage chip toggles its filter, and pressing the active one clears it', async () => {
    const p = setup([idle, silent])
    await userEvent.click(screen.getByRole('button', { name: /Idle 1/ }))
    expect(p.onFilter).toHaveBeenCalledWith('idle')
  })

  it('reports typing in the search box', async () => {
    const p = setup([idle, silent])
    await userEvent.type(screen.getByPlaceholderText(/Name, phone, plate/), 'x')
    expect(p.onQuery).toHaveBeenCalledWith('x')
  })

  it('says so when nobody is online and when nothing matches', () => {
    const { unmount } = render(<DriverList rows={[]} total={0} counts={stageCounts([], NOW)} query="" onQuery={vi.fn()} filter="all" onFilter={vi.fn()} selectedId={null} onSelect={vi.fn()} nowMs={NOW} />)
    expect(screen.getByText('No drivers are online.')).toBeTruthy()
    unmount()
    render(<DriverList rows={[]} total={3} counts={stageCounts([], NOW)} query="zzz" onQuery={vi.fn()} filter="all" onFilter={vi.fn()} selectedId={null} onSelect={vi.fn()} nowMs={NOW} />)
    expect(screen.getByText('No driver matches.')).toBeTruthy()
  })
})
