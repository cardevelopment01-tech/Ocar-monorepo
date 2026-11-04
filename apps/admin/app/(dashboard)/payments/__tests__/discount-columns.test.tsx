// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import type { AdminPaymentItem } from '@/lib/admin-api'

// Value: protects=finance can see the gross fare, the offer discount and what the rider paid on every payment, and
// Gross is amount + discount (payments.amount is the payable); fails_when=a column is dropped or Gross reads amount
// alone; why_new=PR3; seam=none; no_claim=server data (mocked).

const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/admin-api', () => ({ adminPaymentApi: api }))

import PaymentsPage from '../page'
import { grossOf } from '@/lib/payment-amounts'

const pay = (o: Partial<AdminPaymentItem> & { id: string }): AdminPaymentItem => ({
  status: 'completed', channel: 'cash_direct', amount: '363.20', commission_amount: '0.00', driver_earning: '363.20',
  ride_id: '7', user_name: 'Asha', driver_name: 'Ravi', created_at: '2026-11-03T10:00:00Z', ...o,
})

beforeEach(() => {
  api.list.mockResolvedValue({
    payments: [pay({ id: '1', discount_amount: '90.80' }), pay({ id: '2', amount: '300.00', driver_earning: '300.00', discount_amount: '0.00', ride_id: '8' }), pay({ id: '3', amount: '250.00', ride_id: '9' })],
    pagination: { total: 3, page: 1, limit: 20, pages: 1 },
  })
})

// The driver-earning column repeats the paid amount, so read each value from its own column.
function cell(rowText: string, header: string): string {
  const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
  const tr = screen.getByText(rowText).closest('tr') as HTMLElement
  return within(tr).getAllByRole('cell')[headers.indexOf(header)]!.textContent ?? ''
}

describe('Payments: gross, discount and paid', () => {
  it('shows the three columns, and gross is paid plus discount', async () => {
    render(<PaymentsPage />)
    expect(await screen.findByRole('columnheader', { name: 'Gross fare' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Discount' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Paid' })).toBeInTheDocument()
    expect(cell('#1', 'Gross fare')).toBe('₹454')   // 363.20 + 90.80
    expect(cell('#1', 'Discount')).toBe('₹90.8')
    expect(cell('#1', 'Paid')).toBe('₹363.2')
  })

  it('an undiscounted payment, and an older row with no discount field, show ₹0 with gross equal to paid', async () => {
    render(<PaymentsPage />)
    await screen.findByRole('columnheader', { name: 'Paid' })
    expect([cell('#2', 'Gross fare'), cell('#2', 'Discount'), cell('#2', 'Paid')]).toEqual(['₹300', '₹0', '₹300'])
    expect([cell('#3', 'Gross fare'), cell('#3', 'Discount'), cell('#3', 'Paid')]).toEqual(['₹250', '₹0', '₹250'])
  })

  it('grossOf adds the discount and tolerates a missing one', () => {
    expect(grossOf({ amount: '363.20', discount_amount: '90.80' })).toBeCloseTo(454, 2)
    expect(grossOf({ amount: '250.00' })).toBe(250)
  })
})
