import { z } from 'zod'
import { getRuleDef } from './rules'
import type { Benefit, BenefitCatalogEntry, FareComponentKey, Rule } from './offers.types'

/** The fare components a discount can be taken from. Surge, stops, waiting and overage are excluded by default (D4). */
export const COMPONENT_KEYS = ['base', 'distance', 'time', 'stop', 'hourSurcharge', 'waiting', 'surge', 'overage'] as const
export const DEFAULT_APPLIES_TO: FareComponentKey[] = ['base', 'distance', 'time', 'hourSurcharge']

const appliesTo = z.array(z.enum(COMPONENT_KEYS)).min(1).optional()

/**
 * A stored rule. The kind decides the shape, looked up in the registry, so a new rule kind needs no change here.
 * Unknown kinds and bad config come back as issues (a 422 with the path), never a throw.
 */
export const ruleSchema = z
  .object({ kind: z.string() })
  .passthrough()
  .transform((val, ctx): Rule => {
    const def = getRuleDef(val.kind)
    if (!def) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['kind'], message: `Unknown rule kind "${val.kind}"` })
      return z.NEVER
    }
    const parsed = def.schema.safeParse(val)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) ctx.addIssue({ ...issue })
      return z.NEVER
    }
    return parsed.data as Rule
  })

export const benefitSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent_off'), percent: z.number().gt(0).max(100), maxDiscount: z.number().positive().optional(), appliesTo }),
  z.object({ type: z.literal('flat_off'), amount: z.number().positive(), appliesTo }),
  z.object({ type: z.literal('cashback_percent'), percent: z.number().gt(0).max(100), maxCashback: z.number().positive().optional(), expiresInDays: z.number().int().min(1), appliesTo }),
  z.object({ type: z.literal('cashback_flat'), amount: z.number().positive(), expiresInDays: z.number().int().min(1) }),
])

const BENEFITS: BenefitCatalogEntry[] = [
  { type: 'percent_off', label: 'Percentage off', isCashback: false, fields: [
    { key: 'percent', type: 'number', label: 'Percent off' }, { key: 'maxDiscount', type: 'number', label: 'Maximum discount (₹)' }, { key: 'appliesTo', type: 'multi', label: 'Applies to' } ] },
  { type: 'flat_off', label: 'Flat amount off', isCashback: false, fields: [
    { key: 'amount', type: 'number', label: 'Amount off (₹)' }, { key: 'appliesTo', type: 'multi', label: 'Applies to' } ] },
  { type: 'cashback_percent', label: 'Percentage cashback', isCashback: true, fields: [
    { key: 'percent', type: 'number', label: 'Cashback percent' }, { key: 'maxCashback', type: 'number', label: 'Maximum cashback (₹)' }, { key: 'expiresInDays', type: 'number', label: 'Expires after (days)' } ] },
  { type: 'cashback_flat', label: 'Flat cashback', isCashback: true, fields: [
    { key: 'amount', type: 'number', label: 'Cashback (₹)' }, { key: 'expiresInDays', type: 'number', label: 'Expires after (days)' } ] },
]

export function benefitCatalog(): BenefitCatalogEntry[] {
  return BENEFITS
}

export type { Benefit }
