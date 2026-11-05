import type { Benefit, EvalContext, FareComponents, NameLookup, OfferVersionView, Rule, RuleResult } from './offers.types'
import { DEFAULT_APPLIES_TO } from './offers.schemas'
import { getRuleDef } from './rules'
import { roundPaise, sumComponents } from './money'

/** All rules must pass; the first failing rule's reason is returned. An unknown kind fails closed. */
export function evaluateRules(rules: Rule[], ctx: EvalContext): RuleResult {
  for (const rule of rules) {
    const def = getRuleDef(rule.kind)
    if (!def) return { ok: false, reason: 'DISABLED' }
    const res: RuleResult = def.evaluate(rule, ctx)
    if (!res.ok) return res
  }
  return { ok: true }
}

/**
 * What a benefit gives on this fare. Discount is clamped to the eligible components and, when given, to
 * maxDiscountPercent of them (the driver-funded cap, D23); cashback is its own number and never a discount.
 */
export function computeBenefit(
  benefit: Benefit,
  fare: FareComponents,
  maxDiscountPercent?: number,
): { discount: number; cashback: number } {
  if (benefit.type === 'cashback_flat') return { discount: 0, cashback: roundPaise(Math.max(benefit.amount, 0)) }

  const keys = benefit.appliesTo ?? DEFAULT_APPLIES_TO
  const eligible = sumComponents(fare, keys)

  if (benefit.type === 'cashback_percent') {
    const raw = (eligible * benefit.percent) / 100
    return { discount: 0, cashback: roundPaise(Math.min(benefit.maxCashback ?? raw, raw)) }
  }

  let raw = benefit.type === 'percent_off' ? (eligible * benefit.percent) / 100 : benefit.amount
  if (benefit.type === 'percent_off' && benefit.maxDiscount != null) raw = Math.min(raw, benefit.maxDiscount)
  let discount = Math.min(raw, eligible)
  if (maxDiscountPercent != null) discount = Math.min(discount, (eligible * maxDiscountPercent) / 100)
  return { discount: roundPaise(Math.max(discount, 0)), cashback: 0 }
}

/** One plain-English line for an offer, used by every client and the admin form. "20% off, max ₹100, Sedan/SUV, new users". */
export function describeOffer(version: OfferVersionView, names?: NameLookup): string {
  const b = version.benefit
  const head =
    b.type === 'percent_off' ? `${b.percent}% off${b.maxDiscount != null ? `, max ₹${b.maxDiscount}` : ''}`
    : b.type === 'flat_off' ? `₹${b.amount} off`
    : b.type === 'cashback_percent' ? `${b.percent}% cashback${b.maxCashback != null ? `, max ₹${b.maxCashback}` : ''}`
    : `₹${b.amount} cashback`
  const tail = version.rules.flatMap((r) => {
    const def = getRuleDef(r.kind)
    return def ? [def.describe(r, names)] : []
  })
  return [head, ...tail].join(', ')
}
