// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { payMessage, submitPayuForm } from '../lib/payu-checkout'

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
