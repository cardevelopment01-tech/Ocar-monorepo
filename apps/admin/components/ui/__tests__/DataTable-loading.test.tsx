// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import DataTable from '../DataTable'

// Value: protects=the Rides and Users lists showing their real column headers with shimmer rows while loading (no jump when the data
// lands); fails_when=a page goes back to a headerless placeholder or the table stops honouring isLoading; why_new=pages now use it;
// seam=none; no_claim=how it looks (checked by eye).
describe('DataTable loading', () => {
  const columns = [{ key: 'a', header: 'Ride' }, { key: 'b', header: 'Status' }]
  it('keeps the header and shows shimmer rows while loading', () => {
    const { container } = render(<DataTable columns={columns} data={[]} isLoading />)
    expect([...container.querySelectorAll('th')].map(t => t.textContent)).toEqual(['Ride', 'Status'])
    expect(container.querySelectorAll('tbody tr')).toHaveLength(6)
    expect(container.querySelectorAll('.skeleton').length).toBe(12)
  })
  it('shows the rows, not the skeleton, once loaded', () => {
    const { container } = render(<DataTable columns={columns} data={[{ a: '1', b: 'done' }]} />)
    expect(container.querySelectorAll('.skeleton')).toHaveLength(0)
    expect(container.querySelector('tbody')?.textContent).toContain('done')
  })
})
