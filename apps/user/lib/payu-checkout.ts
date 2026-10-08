export interface PayuForm { action: string; fields: Record<string, string> }

// PayU hosted checkout is a redirect: build a hidden form and submit it. PayU
// sends the browser back to the API's /payments/payu/return, which confirms
// the payment and redirects here (ride receipt) with ?pay=success|failed|pending.
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

// Banner copy for the receipt page's ?pay= return flag; success needs no message.
export function payMessage(pay: string | null): string | null {
  if (pay === 'failed') return 'Payment was not completed. You can try again.'
  if (pay === 'pending') return 'We are confirming your payment. This usually takes a minute.'
  return null
}

// Retry errors the API words for the rider (409: previous payment still being
// processed/confirmed, 503: couldn't check it). Show those; "try again" is wrong
// advice for them, so everything else keeps the generic message.
export function retryErrorMessage(err: unknown): string {
  const res = (err as { response?: { status?: number; data?: { error?: unknown } } } | null)?.response
  const msg = res?.data?.error
  if ((res?.status === 409 || res?.status === 503) && typeof msg === 'string' && msg) return msg
  return 'Could not start payment. Please try again.'
}
