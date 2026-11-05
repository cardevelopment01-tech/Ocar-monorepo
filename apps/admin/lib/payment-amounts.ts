import type { AdminPaymentItem } from './admin-api'

/** The fare before any offer: what the rider paid (payments.amount) plus what the offer took off. */
export const grossOf = (p: Pick<AdminPaymentItem, 'amount' | 'discount_amount'>): number => parseFloat(p.amount) + parseFloat(p.discount_amount ?? '0')

export const rupees = (n: number): string => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
