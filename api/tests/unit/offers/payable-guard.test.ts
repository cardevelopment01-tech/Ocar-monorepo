import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { payableOf } from '@/modules/offers/settlement'

// Two guards for the offers money model (offers plan Task 7, review decisions D7 and D22).
// 1) Readers: every raw COALESCE(total_final, total_estimated) is the GROSS fare. Anything that tells a rider or driver
//    what is paid must go through ocar_payable(); a new raw reader fails here until someone classifies it.
// 2) Writers: every statement that sets total_final or total_estimated must be followed by finaliseDiscount, or the
//    discount goes stale. A new writer fails here until it calls the helper.
// Value: protects=no screen/settlement quietly shows or bills the gross fare, no fare write skips the discount;
// fails_when=a new reader or writer is added without being classified; why_new=nothing else notices a sixth writer;
// seam=none; no_claim=what each call site does with the number (the lifecycle integration test covers settlement).

const SRC = join(__dirname, '..', '..', '..', 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return sourceFiles(p)
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })
}
const files = sourceFiles(SRC).map((p) => ({ rel: relative(SRC, p).split(sep).join('/'), text: readFileSync(p, 'utf8') }))
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length

describe('gross-fare readers are classified', () => {
  // Raw COALESCE(..total_final, ..total_estimated) not wrapped in ocar_payable(). Admin lists show the gross "fare" next
  // to the payment's own paid amount; Task 9 adds the Gross / Paid / Discount columns.
  const GROSS_DISPLAY_ALLOWLIST: Record<string, number> = { 'modules/admin/admin.repository.ts': 4 }

  it('no unclassified raw reader exists', () => {
    const found: Record<string, number> = {}
    for (const f of files) {
      const n = count(f.text, /(?<!ocar_payable\()COALESCE\((fs\.)?total_final, (fs\.)?total_estimated\)/g)
      if (n > 0) found[f.rel] = n
    }
    expect(found).toEqual(GROSS_DISPLAY_ALLOWLIST)
  })
})

describe('every fare write re-derives the discount', () => {
  // Statements that SET a fare total, per file (an UPDATE assigning total_final = or total_estimated =).
  const WRITERS: Record<string, number> = {
    'modules/rides/rides.service.ts': 7, // add stop, early end, early end of a rental (billed the quote, D7), force-complete, rental, generic settle, one-way wait
    'modules/rides/rides.repository.ts': 1, // updateFareSnapshotEstimate, called by the scheduled re-quote
  }
  // finaliseDiscount call sites that cover them. updateFareSnapshotEstimate is covered by its only caller.
  const CALLERS: Record<string, number> = {
    'modules/rides/rides.service.ts': 7,
    'jobs/processors/dispatch-scheduled.processor.ts': 1,
  }

  it('the set of files that write a fare total has not grown', () => {
    const found: Record<string, number> = {}
    for (const f of files) {
      // SQL assignments only: an UPDATE ... SET list (TypeScript comparisons are not assignments in a template string).
      const sqlAssigns = (f.text.match(/(SET|,)\s+(fs\.)?total_(final|estimated)\s*=\s*[^=]/g) ?? []).length
      if (sqlAssigns > 0) found[f.rel] = sqlAssigns
    }
    expect(found).toEqual(WRITERS)
  })

  it('each writer is followed by a finaliseDiscount call', () => {
    for (const [file, calls] of Object.entries(CALLERS)) {
      const f = files.find((x) => x.rel === file)!
      expect(count(f.text, /finaliseDiscount\(/g), file).toBeGreaterThanOrEqual(calls)
    }
  })

  it('createPaymentRecord and payableForRide re-derive too, so a missed writer cannot bill the wrong amount', () => {
    const pay = files.find((x) => x.rel === 'modules/payments/payments.service.ts')!
    expect(pay.text).toMatch(/await finaliseDiscount\(q, rideId\)/)
    const settle = files.find((x) => x.rel === 'modules/offers/settlement.ts')!
    expect(settle.text).toMatch(/export async function payableForRide[\s\S]*await finaliseDiscount\(q, rideId\)/)
  })
})

describe('payableOf', () => {
  it('matches ocar_payable for the sample pairs (the SQL side is asserted in the schema integration test)', () => {
    expect(payableOf({ total: 454, discount_amount: 90.8 })).toBe(363.2)
    expect(payableOf({ total: 100, discount_amount: 150 })).toBe(0)
    expect(payableOf({ total: 454, discount_amount: 0 })).toBe(454)
    expect(payableOf({ total: 0, discount_amount: 0 })).toBe(0)
    expect(payableOf({ total: '454.00' })).toBe(454)
    expect(payableOf({ total: 33.335, discount_amount: 10 })).toBe(23.34)
  })
})
