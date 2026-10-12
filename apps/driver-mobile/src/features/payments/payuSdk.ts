import { NativeEventEmitter, NativeModules, type EmitterSubscription } from 'react-native'
import type { SdkOrder } from './api'
import type { SdkExit } from './paymentMachine'

// Thin wrapper over payu-non-seam-less-react (legacy native module). Rules:
//  - never use the SDK's makeHttpRequest (it installs a trust-all TLS manager);
//    hashes are answered through our own authenticated API via `sign`;
//  - never log SDK payloads (they carry hashes and customer details);
//  - one payment at a time, listeners always removed, so remounts cannot double-handle.

type PayuModule = {
  openCheckoutScreen: (params: Record<string, unknown>) => void
  hashGenerated: (hashes: Record<string, string>) => void
}

const sdk = (): PayuModule | null => (NativeModules['PayUBizSdk'] as PayuModule | undefined) ?? null

export const sdkAvailable = (): boolean => sdk() !== null

const BRAND_TEAL = '#0E8FA3'
const BRAND_INK = '#14171A'

export type PayMode = 'UPI' | 'CARD' | 'NB' | 'WALLET'

let active = false

export function startSdkPayment(
  order: SdkOrder,
  sign: (hashName: string, hashString: string) => Promise<string>,
  // One mode opens PayU straight on that method (our own method picker comes first); none = all four.
  mode?: PayMode,
): Promise<SdkExit> {
  const mod = sdk()
  if (!mod) return Promise.resolve('error')
  if (active) return Promise.resolve('error') // another payment owns the SDK

  active = true
  return new Promise<SdkExit>((resolve) => {
    const emitter = new NativeEventEmitter(mod as never)
    const subs: EmitterSubscription[] = []
    let done = false
    const finish = (exit: SdkExit): void => {
      if (done) return
      done = true
      subs.forEach((s) => s.remove())
      active = false
      resolve(exit)
    }

    subs.push(emitter.addListener('onPaymentSuccess', () => finish('success')))
    subs.push(emitter.addListener('onPaymentFailure', () => finish('failure')))
    subs.push(emitter.addListener('onPaymentCancel', () => finish('cancel')))
    subs.push(emitter.addListener('onError', () => finish('error')))
    subs.push(
      emitter.addListener('generateHash', (p: { hashName?: string; hashString?: string }) => {
        const name = p.hashName ?? ''
        void sign(name, p.hashString ?? '')
          .then((hash) => mod.hashGenerated({ [name]: hash }))
          // An empty hash makes the SDK show its own error instead of hanging.
          .catch(() => mod.hashGenerated({ [name]: '' }))
      }),
    )

    try {
      mod.openCheckoutScreen({
        payUPaymentParams: {
          key: order.key,
          amount: order.amount,
          productInfo: order.productInfo,
          firstName: order.firstName,
          email: order.email,
          phone: order.phone,
          transactionId: order.transactionId,
          android_surl: order.surl,
          android_furl: order.furl,
          environment: order.environment,
          // The SDK refuses to proceed without a userCredential even with saved cards off
          // ("user_credentials is missing"). A per-order id means nothing is ever shared or
          // reused between payments, so saved cards stay effectively off in v1.
          userCredential: `${order.key}:${order.transactionId}`,
        },
        payUCheckoutProConfig: {
          merchantName: 'Ocar',
          primaryColor: BRAND_TEAL,
          secondaryColor: BRAND_INK,
          showExitConfirmationOnCheckoutScreen: true,
          // A wallet deposit never needs EMI / BNPL / NEFT: show only what a driver actually uses.
          enforcePaymentList: (mode ? [mode] : (['UPI', 'CARD', 'NB', 'WALLET'] as const)).map((payment_type) => ({ payment_type })),
          // UPI apps first: the fastest path for most drivers.
          paymentModesOrder: [{ UPI: 'TEZ' }, { UPI: 'PHONEPE' }, { Wallets: 'PAYTM' }],
          // Order summary line inside the sheet.
          cartDetails: [{ [order.productInfo]: `₹${order.amount}` }],
        },
      })
    } catch {
      finish('error')
    }
  })
}
