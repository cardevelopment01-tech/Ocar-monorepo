// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { payMessage, submitPayuForm } from '../payu-checkout'

describe('payMessage', () => {
  it('maps wallet returns; only success contains "success"', () => {
    expect(payMessage('success', 'wallet')).toBe('Payment successful — your wallet has been topped up.')
    expect(payMessage('failed', 'wallet')).toBe('Payment failed. Please try again.')
    expect(payMessage('pending', 'wallet')).toBe('We are confirming your payment. Your balance will update shortly.')
    expect(payMessage('success', 'wallet')).toContain('success')
    expect(payMessage('failed', 'wallet')).not.toContain('success')
    expect(payMessage('pending', 'wallet')).not.toContain('success')
  })

  it('maps package returns', () => {
    expect(payMessage('success', 'package')).toBe('Payment successful — your ride credit has been added.')
    expect(payMessage('failed', 'package')).toBe('Payment failed. Please try again.')
    expect(payMessage('pending', 'package')).toBe('We are confirming your payment. Your ride credit will appear shortly.')
  })

  it('ignores null and junk', () => {
    for (const kind of ['wallet', 'package'] as const) {
      expect(payMessage(null, kind)).toBeNull()
      expect(payMessage('junk', kind)).toBeNull()
    }
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
