import type { z } from 'zod'

/** The fare split a discount is judged against. Gross amounts, same keys as the quote's breakdown. */
export type FareComponents = {
  base: number
  distance: number
  time: number
  stop: number
  hourSurcharge: number
  waiting: number
  surge: number
  overage: number
}
export type FareComponentKey = keyof FareComponents

export type RideType = 'one_way' | 'round_trip' | 'rental'
export type PaymentChannel = 'cash' | 'online' | 'wallet'

export type EvalContext = {
  now: Date
  user: { id: bigint; completedRides: number; createdAt: Date }
  ride: {
    rideType: RideType
    categoryId: number
    cityId: number | null
    originCityId: number | null
    destinationCityId: number | null
    paymentChannel: PaymentChannel
    scheduledFor: Date | null
  }
  fare: FareComponents
}

export type ReasonCode =
  | 'DISABLED' | 'NOT_STARTED' | 'EXPIRED' | 'MIN_FARE' | 'RIDE_TYPE' | 'CATEGORY' | 'CITY' | 'ROUTE'
  | 'PAYMENT_CHANNEL' | 'NEW_USERS_ONLY' | 'FIRST_N_RIDES' | 'SCHEDULE' | 'USER_LIMIT' | 'GLOBAL_LIMIT'
  | 'BUDGET' | 'NOT_ASSIGNED' | 'UNKNOWN_CODE' | 'COMMISSION_ACTIVE' | 'NOT_COMMISSION_CITY'

export type RuleResult = { ok: true } | { ok: false; reason: ReasonCode; detail?: Record<string, number | string> }

/** A stored rule: `kind` plus that kind's config. Validated against the registry on write. */
export type Rule = { kind: string } & Record<string, unknown>

export type FieldSpec = {
  key: string
  type: 'number' | 'text' | 'enum' | 'multi' | 'dateRange' | 'hours'
  label: string
  options?: { value: string; label: string }[]
}

/** Names the describe() helpers can use for ids. Missing ids fall back to a count. */
export type NameLookup = { category?: Record<string, string>; city?: Record<string, string> }

export type RuleDef<T = Record<string, unknown>> = {
  kind: string
  label: string
  fields: FieldSpec[]
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
  evaluate: (cfg: T, ctx: EvalContext) => RuleResult
  describe: (cfg: T, names?: NameLookup) => string
}

export type RuleCatalogEntry = { kind: string; label: string; fields: FieldSpec[] }
export type BenefitCatalogEntry = { type: Benefit['type']; label: string; fields: FieldSpec[]; isCashback: boolean }

export type Benefit =
  | { type: 'percent_off'; percent: number; maxDiscount?: number; appliesTo?: FareComponentKey[] }
  | { type: 'flat_off'; amount: number; appliesTo?: FareComponentKey[] }
  | { type: 'cashback_percent'; percent: number; maxCashback?: number; expiresInDays: number; appliesTo?: FareComponentKey[] }
  | { type: 'cashback_flat'; amount: number; expiresInDays: number }

export type OfferVersionView = {
  rules: Rule[]
  benefit: Benefit
  per_user_limit?: number | null
}
