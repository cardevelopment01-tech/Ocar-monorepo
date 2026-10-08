import { api } from '@/services/api'
import type { ConfirmResult } from './paymentMachine'

// What the native PayU SDK needs for one order. Built server-side; the app holds
// no PayU key or salt (key is the public merchant key, returned per order).
export type SdkOrder = {
  key: string
  environment: '0' | '1'
  transactionId: string
  amount: string
  productInfo: string
  firstName: string
  email: string
  phone: string
  surl: string
  furl: string
}

type SdkOrderResponse = { sdk?: SdkOrder; dev?: true }

export class PaymentsUnavailableError extends Error {}

async function toSdkOrder(res: Promise<{ data: SdkOrderResponse }>): Promise<SdkOrder> {
  try {
    const { data } = await res
    if (!data.sdk) throw new PaymentsUnavailableError('no sdk order') // dev-mode credit path is not used by the app
    return data.sdk
  } catch (err) {
    // 403 = kill switch off (mobile_payments_enabled=false)
    if ((err as { response?: { status?: number } }).response?.status === 403) throw new PaymentsUnavailableError('disabled')
    throw err
  }
}

export const createTopupOrder = (amount: number): Promise<SdkOrder> =>
  toSdkOrder(api.post('/api/v1/payments/wallet/driver/topup/order', { amount, client: 'sdk' }))

export const createPackageOrder = (tierId: string): Promise<SdkOrder> =>
  toSdkOrder(api.post('/api/v1/payments/packages/purchase/order', { tierId, client: 'sdk' }))

export async function signHash(hashName: string, hashString: string): Promise<string> {
  const res = await api.post('/api/v1/payments/payu/sdk-hash', { hashName, hashString })
  return (res.data as { hash: string }).hash
}

export async function confirmPayment(txnId: string): Promise<ConfirmResult> {
  const res = await api.post('/api/v1/payments/payu/confirm', { txnId })
  return (res.data as { result: ConfirmResult }).result
}

export type PackageTier = {
  id: string
  name?: string
  price: string
  threshold_value: string
  is_active?: boolean
}

export async function fetchPackageTiers(): Promise<PackageTier[]> {
  const res = await api.get('/api/v1/payments/packages/tiers')
  return res.data as PackageTier[]
}

export async function fetchPackageWallet(): Promise<{ balance: string; is_frozen: boolean }> {
  const res = await api.get('/api/v1/payments/packages/wallet')
  return res.data as { balance: string; is_frozen: boolean }
}
