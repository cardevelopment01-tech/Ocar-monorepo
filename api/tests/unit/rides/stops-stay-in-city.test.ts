import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/modules/rides/rides.repository', () => ({
  getRideCoreById: vi.fn(), getRideStops: vi.fn(), appendRideStop: vi.fn(), getRideStopCharge: vi.fn(),
}))
vi.mock('@/db/client', () => ({ pool: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }) }, withTransaction: vi.fn() }))
vi.mock('@/websocket/socket.server', () => ({ socketEvents: { sendStopAdded: vi.fn() }, getIO: vi.fn() }))
vi.mock('@/modules/notifications/templates.service', () => ({ renderTemplate: vi.fn().mockResolvedValue({ subject: 's', body: 'b' }) }))
vi.mock('@/modules/notifications/notifications.service', () => ({
  notifyOwner: vi.fn(), notifyRideEvent: vi.fn(), notifyRidePaymentFailed: vi.fn(), notifyAllAdmins: vi.fn(),
}))
// A stand-in city: any two points with lat < 20.5 are inside it.
vi.mock('@/modules/geo/geo.service', () => ({
  classifyTrip: vi.fn(async (aLat: number, _aLng: number, bLat: number) =>
    aLat < 20.5 && bLat < 20.5 ? { scope: 'in_city' } : { scope: 'outstation' }),
  findNearestCity: vi.fn(), getRoute: vi.fn(), snapTrailToRoads: vi.fn(),
}))

import * as repo from '@/modules/rides/rides.repository'
import { addRideStop } from '@/modules/rides/rides.service'

const USER = BigInt(7), RIDE = BigInt(101)
const INSIDE = { lat: 20.30, lng: 85.83, address: 'Patia' }
const OUTSIDE = { lat: 21.50, lng: 86.50, address: 'Balasore' }
const ride = (over: Record<string, unknown>) => ({
  id: RIDE, user_id: USER, driver_id: null, status: 'in_progress', category_id: BigInt(1),
  origin_lat: 20.10, origin_lng: 85.70, dest_lat: 20.40, dest_lng: 85.90, ...over,
}) as never

describe('stops on a city ride or rental stay inside the pickup city', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(repo.getRideStops).mockResolvedValue([])
    vi.mocked(repo.getRideStopCharge).mockResolvedValue(0)
    vi.mocked(repo.appendRideStop).mockResolvedValue({ id: BigInt(9), sequence: 1, lat: 20.3, lng: 85.83, status: 'pending' } as never)
  })

  it.each([
    ['city ride', { ride_type: 'one_way', trip_mode: 'city' }],
    ['rental', { ride_type: 'rental', trip_mode: 'standard' }],
  ])('%s: refuses a stop outside the city', async (_n, over) => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride(over))
    await expect(addRideStop(USER, RIDE, OUTSIDE)).rejects.toMatchObject({ httpStatus: 422, appCode: 'STOP_OUTSIDE_CITY' })
    expect(repo.appendRideStop).not.toHaveBeenCalled()
  })

  it.each([
    ['city ride', { ride_type: 'one_way', trip_mode: 'city' }],
    ['rental', { ride_type: 'rental', trip_mode: 'standard' }],
  ])('%s: accepts a stop inside the city', async (_n, over) => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride(over))
    await addRideStop(USER, RIDE, INSIDE)
    expect(repo.appendRideStop).toHaveBeenCalled()
  })

  it('an intercity one-way may still stop outside the pickup city', async () => {
    vi.mocked(repo.getRideCoreById).mockResolvedValue(ride({ ride_type: 'one_way', trip_mode: 'standard', dest_lat: 21.6, dest_lng: 86.6 }))
    await addRideStop(USER, RIDE, OUTSIDE)
    expect(repo.appendRideStop).toHaveBeenCalled()
  })
})
