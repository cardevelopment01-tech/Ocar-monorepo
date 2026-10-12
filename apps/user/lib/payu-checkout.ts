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
