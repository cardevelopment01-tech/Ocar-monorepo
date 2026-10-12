import { describe, it, expect } from 'vitest'
import {
  paymentReducer as r, initialPayment, isBusy, shouldPersist, environmentMatches, topupAmountError,
  pollDelayMs, MAX_CONFIRM_ATTEMPTS, type PaymentState, type PaymentEvent,
} from './paymentMachine'

const run = (events: PaymentEvent[], from: PaymentState = initialPayment): PaymentState => events.reduce(r, from)
const start: PaymentEvent[] = [{ type: 'START', kind: 'topup' }, { type: 'ORDER_READY', txnId: 'W1x' }]

describe('paymentReducer', () => {
  it('happy path: idle -> creating -> sdk -> confirming -> credited', () => {
    expect(run(start)).toEqual({ phase: 'sdk', kind: 'topup', txnId: 'W1x' })
    const s = run([...start, { type: 'SDK_EXIT', exit: 'success' }])
    expect(s).toMatchObject({ phase: 'confirming', exit: 'success', attempt: 0 })
    expect(run([{ type: 'CONFIRM_RESULT', result: 'success' }], s)).toEqual({ phase: 'credited', kind: 'topup' })
  })

  it('ignores a second START while busy (double tap)', () => {
    const s = run(start)
    expect(r(s, { type: 'START', kind: 'package' })).toBe(s)
    expect(r(run([{ type: 'START', kind: 'topup' }]), { type: 'START', kind: 'topup' })).toMatchObject({ phase: 'creating' })
  })

  it('a failed order creation ends in failed (unavailable when the kill switch is off)', () => {
    expect(run([{ type: 'START', kind: 'topup' }, { type: 'ORDER_FAILED' }])).toMatchObject({ phase: 'failed', reason: 'order' })
    expect(run([{ type: 'START', kind: 'topup' }, { type: 'ORDER_FAILED', unavailable: true }])).toMatchObject({ reason: 'unavailable' })
  })

  it('confirms even after a cancel/failure/error exit, and only the server decides', () => {
    for (const exit of ['cancel', 'failure', 'error'] as const) {
      const s = run([...start, { type: 'SDK_EXIT', exit }])
      expect(s.phase).toBe('confirming')
    }
    const failedExit = run([...start, { type: 'SDK_EXIT', exit: 'failure' }, { type: 'CONFIRM_RESULT', result: 'success' }])
    expect(failedExit.phase).toBe('credited') // SDK said failure, bank had actually captured
  })

  it('cancel + server still pending -> cancelled, no 60 s wait', () => {
    expect(run([...start, { type: 'SDK_EXIT', exit: 'cancel' }, { type: 'CONFIRM_RESULT', result: 'pending' }]).phase).toBe('cancelled')
  })

  it('success exit + server pending keeps polling, then settles into pending', () => {
    let s = run([...start, { type: 'SDK_EXIT', exit: 'success' }])
    for (let i = 1; i < MAX_CONFIRM_ATTEMPTS; i++) {
      s = r(s, { type: 'CONFIRM_RESULT', result: 'pending' })
      expect(s).toMatchObject({ phase: 'confirming', attempt: i })
    }
    s = r(s, { type: 'CONFIRM_RESULT', result: 'pending' })
    expect(s).toEqual({ phase: 'pending', kind: 'topup', txnId: 'W1x' })
  })

  it('network errors during confirm retry the same way (outcome unknown, never failed)', () => {
    let s = run([...start, { type: 'SDK_EXIT', exit: 'success' }])
    for (let i = 0; i < MAX_CONFIRM_ATTEMPTS; i++) s = r(s, { type: 'CONFIRM_ERROR' })
    expect(s.phase).toBe('pending')
  })

  it('server failed -> failed(payment)', () => {
    expect(run([...start, { type: 'SDK_EXIT', exit: 'failure' }, { type: 'CONFIRM_RESULT', result: 'failed' }]))
      .toEqual({ phase: 'failed', kind: 'topup', reason: 'payment' })
  })

  it('duplicate / late events are ignored', () => {
    const credited = run([...start, { type: 'SDK_EXIT', exit: 'success' }, { type: 'CONFIRM_RESULT', result: 'success' }])
    expect(r(credited, { type: 'SDK_EXIT', exit: 'failure' })).toBe(credited)
    expect(r(credited, { type: 'CONFIRM_RESULT', result: 'failed' })).toBe(credited)
    expect(r(initialPayment, { type: 'SDK_EXIT', exit: 'success' })).toBe(initialPayment)
    expect(r(initialPayment, { type: 'CONFIRM_ERROR' })).toBe(initialPayment)
  })

  it('RESUME (app relaunched mid-payment) goes straight to confirming; only from idle', () => {
    expect(r(initialPayment, { type: 'RESUME', kind: 'package', txnId: 'P1x' }))
      .toEqual({ phase: 'confirming', kind: 'package', txnId: 'P1x', attempt: 0, exit: 'resume' })
    const busy = run(start)
    expect(r(busy, { type: 'RESUME', kind: 'topup', txnId: 'other' })).toBe(busy)
  })

  it('RESET returns terminal states to idle but never interrupts a live payment', () => {
    expect(r({ phase: 'credited', kind: 'topup' }, { type: 'RESET' })).toBe(initialPayment)
    expect(r({ phase: 'pending', kind: 'topup', txnId: 'x' }, { type: 'RESET' })).toBe(initialPayment)
    const busy = run(start)
    expect(r(busy, { type: 'RESET' })).toBe(busy)
  })
})

describe('helpers', () => {
  it('isBusy / shouldPersist', () => {
    expect(isBusy(run(start))).toBe(true)
    expect(isBusy({ phase: 'credited', kind: 'topup' })).toBe(false)
    expect(shouldPersist(run(start))).toBe(true)
    expect(shouldPersist({ phase: 'pending', kind: 'topup', txnId: 'x' })).toBe(true)
    expect(shouldPersist({ phase: 'credited', kind: 'topup' })).toBe(false)
    expect(shouldPersist(initialPayment)).toBe(false)
  })
  it('environment guard refuses a test build against live PayU and vice versa', () => {
    expect(environmentMatches('prod', '0')).toBe(true)
    expect(environmentMatches('prod', '1')).toBe(false)
    expect(environmentMatches('test', '1')).toBe(true)
    expect(environmentMatches(undefined, '1')).toBe(true)
    expect(environmentMatches(undefined, '0')).toBe(false)
    expect(environmentMatches('test', '0')).toBe(false)
  })
  it('amount validation', () => {
    expect(topupAmountError(100)).toBeNull()
    expect(topupAmountError(50_000)).toBeNull()
    expect(topupAmountError(99)).toMatch(/Minimum/)
    expect(topupAmountError(50_001)).toMatch(/Maximum/)
    expect(topupAmountError(150.5)).toMatch(/whole/)
    expect(topupAmountError(NaN)).toMatch(/Minimum/)
  })
  it('poll delay grows and caps', () => {
    expect(pollDelayMs(0)).toBe(2000)
    expect(pollDelayMs(3)).toBe(5000)
    expect(pollDelayMs(20)).toBe(8000)
  })
})
