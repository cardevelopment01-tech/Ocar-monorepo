import { rideApi } from '@/lib/ride-api'

// Opens Razorpay Checkout for the online-payment fare and verifies the
// result server-side. Mirrors the driver app's wallet top-up Checkout flow
// (apps/driver/src/pages/Wallet.tsx) — same script id/load pattern.
// onVerified fires after the server confirms the payment (used by callers that
// need to refresh UI, e.g. the receipt page clearing its "Pay now" banner).
export async function openRidePaymentCheckout(
  rideId: string,
  opts: { orderId: string; key: string; amount: number },
  onVerified?: () => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (document.getElementById('rzp-script')) { resolve(); return }
    const s = document.createElement('script')
    s.id = 'rzp-script'
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = reject
    document.body.appendChild(s)
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rzp = new (window as any).Razorpay({
    key: opts.key,
    order_id: opts.orderId,
    amount: Math.round(opts.amount * 100),
    currency: 'INR',
    name: 'Ocar',
    description: `Ride #${rideId}`,
    handler: async (response: {
      razorpay_order_id: string
      razorpay_payment_id: string
      razorpay_signature: string
    }) => {
      await rideApi.verifyPayment(rideId, {
        orderId: response.razorpay_order_id,
        paymentId: response.razorpay_payment_id,
        signature: response.razorpay_signature,
      })
      onVerified?.()
    },
  })
  rzp.open()
}
