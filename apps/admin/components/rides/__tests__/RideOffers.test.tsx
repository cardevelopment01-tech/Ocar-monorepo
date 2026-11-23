// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import RideOffers, { offerSummary } from '../RideOffers'
import type { AdminRideOffer } from '@/lib/admin-api'

const offer = (over: Partial<AdminRideOffer>): AdminRideOffer => ({
  id: '1', driver_id: '10', driver_name: 'Ravi Das', driver_phone: '+919000000001', status: 'declined', broadcast_round: 1,
  offered_at: '2026-11-20T10:00:00Z', acked_at: '2026-11-20T10:00:01Z', responded_at: '2026-11-20T10:00:09Z',
  expires_at: '2026-11-20T10:02:00Z', distance_km: 2.46, ...over,
})

describe('offerSummary', () => {
  it('says so when nobody was asked', () => { expect(offerSummary([])).toBe('No driver was offered this ride') })
  it('counts drivers, rounds and outcomes', () => {
    const s = offerSummary([offer({}), offer({ id: '2', status: 'expired' }), offer({ id: '3', status: 'expired', broadcast_round: 2 }), offer({ id: '4', status: 'accepted', broadcast_round: 2 })])
    expect(s).toBe('4 drivers offered over 2 rounds: 1 accepted, 1 declined, 2 expired')
  })
  it('uses the singular for one driver in one round', () => { expect(offerSummary([offer({})])).toBe('1 driver offered over 1 round: 1 declined') })
})

describe('RideOffers', () => {
  it('groups by round and shows distance, reply time and app confirmation', () => {
    render(<RideOffers offers={[offer({}), offer({ id: '2', broadcast_round: 2, driver_name: null, driver_phone: '+919000000002', status: 'expired', acked_at: null, responded_at: null, distance_km: null })]} />)
    expect(screen.getByText('Round 1')).toBeInTheDocument()
    expect(screen.getByText('Round 2')).toBeInTheDocument()
    expect(screen.getByText(/2\.5 km away/)).toBeInTheDocument()
    expect(screen.getByText(/app confirmed in 1s/)).toBeInTheDocument()
    expect(screen.getByText('after 9s')).toBeInTheDocument()
    // a driver with no name falls back to their phone; an offer the app never confirmed is called out
    expect(screen.getByText('+919000000002')).toBeInTheDocument()
    expect(screen.getByText(/app did not confirm receipt/)).toBeInTheDocument()
  })
  it('links the driver to their admin page', () => {
    render(<RideOffers offers={[offer({})]} />)
    expect(screen.getByRole('link', { name: 'Ravi Das' })).toHaveAttribute('href', '/drivers/10')
  })
  it('explains an empty history', () => {
    render(<RideOffers offers={[]} />)
    expect(screen.getByText(/No driver was offered this ride/)).toBeInTheDocument()
  })
})
