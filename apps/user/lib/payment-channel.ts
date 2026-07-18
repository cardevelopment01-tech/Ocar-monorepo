export type PaymentChannel = 'cash' | 'online' | 'wallet'

const KEY = 'ocar_payment_channel'

export function getPaymentChannel(): PaymentChannel {
  if (typeof window === 'undefined') return 'cash'
  const v = window.localStorage.getItem(KEY)
  return v === 'online' || v === 'wallet' ? v : 'cash'
}

export function setPaymentChannel(channel: PaymentChannel): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, channel)
}

export function clearPaymentChannel(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(KEY)
}
