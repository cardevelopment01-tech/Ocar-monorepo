// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { payMessage, retryErrorMessage, submitPayuForm } from '../lib/payu-checkout'

describe('payMessage', () => {
  it('maps failed and pending, ignores everything else', () => {
    expect(payMessage('failed')).toBe('Payment was not completed. You can try again.')
    expect(payMessage('pending')).toBe('We are confirming your payment. This usually takes a minute.')
    expect(payMessage('success')).toBeNull()
    expect(payMessage(null)).toBeNull()
    expect(payMessage('junk')).toBeNull()
  })
})

describe('submitPayuForm', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })

  it('appends a hidden POST form with one input per field and submits once', () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    const fields = { key: 'k', 'a&b': 'x"y<z>&', empty: '' }
    submitPayuForm({ action: 'https://secure.payu.in/_payment', fields })

    const form = document.body.querySelector('form')!
    expect(form.method).toBe('post')
    expect(form.action).toBe('https://secure.payu.in/_payment')
    const inputs = [...form.querySelectorAll('input')]
    expect(inputs).toHaveLength(3)
    expect(inputs.every(i => i.type === 'hidden')).toBe(true)
    expect(Object.fromEntries(inputs.map(i => [i.name, i.value]))).toEqual(fields)
    expect(submit).toHaveBeenCalledTimes(1)
  })
})

describe('retryErrorMessage', () => {
  const generic = 'Could not start payment. Please try again.'
  const axiosErr = (status: number, error: unknown) => ({ response: { status, data: { error } } })

  it('shows the server wording for 409 and 503', () => {
    expect(retryErrorMessage(axiosErr(409, 'Payment is already being confirmed'))).toBe('Payment is already being confirmed')
    expect(retryErrorMessage(axiosErr(503, 'Could not check your previous payment. Please try again shortly.')))
      .toBe('Could not check your previous payment. Please try again shortly.')
  })

  it('keeps the generic message for other statuses, missing or non-string bodies, and non-axios errors', () => {
    expect(retryErrorMessage(axiosErr(500, 'internal detail'))).toBe(generic)
    expect(retryErrorMessage(axiosErr(409, undefined))).toBe(generic)
    expect(retryErrorMessage(axiosErr(409, { nested: true }))).toBe(generic)
    expect(retryErrorMessage(axiosErr(409, ''))).toBe(generic)
    expect(retryErrorMessage(new Error('network'))).toBe(generic)
    expect(retryErrorMessage(null)).toBe(generic)
  })
})
