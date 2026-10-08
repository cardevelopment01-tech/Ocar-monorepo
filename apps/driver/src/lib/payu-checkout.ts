export interface PayuForm { action: string; fields: Record<string, string> }

// PayU hosted checkout is a redirect: build a hidden form and submit it. PayU
// sends the browser back to the API's /payments/payu/return, which confirms
// the payment and redirects here (/wallet or /recharge-package) with
// ?pay=success|failed|pending.
export function submitPayuForm(form: PayuForm): void {
  const el = document.createElement('form')
  el.method = 'POST'
  el.action = form.action
  el.style.display = 'none'
  for (const [name, value] of Object.entries(form.fields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    el.appendChild(input)
  }
  document.body.appendChild(el)
  el.submit()
}

// Banner copy for the ?pay= return flag. Wallet.tsx colours a message green when
// it includes 'success'; only the success copy may contain that word.
export function payMessage(pay: string | null, kind: 'wallet' | 'package'): string | null {
  const wallet = kind === 'wallet'
  if (pay === 'success') return wallet ? 'Payment successful — your wallet has been topped up.' : 'Payment successful — your ride credit has been added.'
  if (pay === 'failed') return 'Payment failed. Please try again.'
  if (pay === 'pending') return wallet
    ? 'We are confirming your payment. Your balance will update shortly.'
    : 'We are confirming your payment. Your ride credit will appear shortly.'
  return null
}
