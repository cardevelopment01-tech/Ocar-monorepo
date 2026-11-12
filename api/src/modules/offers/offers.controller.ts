import type { RequestHandler } from 'express'
import { z } from 'zod'
import { getConfigValue } from '@/lib/system-config'
import { findActiveOffers, getUserUsage, listGrantedOfferIds } from './offers.repository'
import { parseOrThrow } from './admin-offers.service'
import { previewOffers, type PreviewInput } from './offers.service'
import { describeOffer } from './engine'
import { findNearestCity } from '@/modules/geo/geo.service'
import { offersPreviewRejectionsTotal } from '@/observability/offers-metrics'

export const previewSchema = z.object({
  category_id: z.number().int().positive(),
  ride_type: z.enum(['one_way', 'round_trip', 'rental']),
  // 'city' = a metered in-city ride: it is matched on the City ride offers, and quoted on the city card.
  trip_mode: z.enum(['standard', 'city']).optional(),
  is_return_cab: z.boolean().optional(),
  distance_km: z.number().nonnegative(),
  duration_min: z.number().nonnegative(),
  stop_count: z.number().int().nonnegative().optional(),
  trip_hours: z.number().nonnegative().optional(),
  rental_package_id: z.number().int().positive().optional(),
  city_id: z.number().int().positive().optional(),
  originCityId: z.number().int().positive().nullable().optional(),
  destinationCityId: z.number().int().positive().nullable().optional(),
  // The pickup and drop. When given, the cities are derived from them exactly as the booking does, so the preview and the
  // booking can never disagree about a city or route rule.
  originLat: z.number().min(-90).max(90).optional(),
  originLng: z.number().min(-180).max(180).optional(),
  destinationLat: z.number().min(-90).max(90).optional(),
  destinationLng: z.number().min(-180).max(180).optional(),
  code: z.string().trim().max(40).optional(),
  autoOffer: z.string().regex(/^(none|\d{1,18})$/).optional(),
  paymentChannel: z.enum(['cash', 'online', 'wallet']),
  scheduledFor: z.string().datetime({ offset: true }).optional(),
})

export const preview: RequestHandler = async (req, res, next) => {
  try {
    const body = parseOrThrow(previewSchema, req.body)
    // exactOptionalPropertyTypes: drop undefined keys instead of passing them through.
    const { originLat, originLng, destinationLat, destinationLng, ...rest } = body
    const input = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as unknown as PreviewInput
    const [origin, dest] = await Promise.all([
      originLat !== undefined && originLng !== undefined ? findNearestCity(originLat, originLng) : null,
      destinationLat !== undefined && destinationLng !== undefined ? findNearestCity(destinationLat, destinationLng) : undefined,
    ])
    if (origin) { input.city_id = origin.id; input.originCityId = origin.id }
    if (dest !== undefined) input.destinationCityId = dest?.id ?? null
    const result = await previewOffers(req.user!.id, input)
    // Only a wrong typed code counts toward the guess limit (see offersCodeGuessLimiters).
    res.locals['codeGuessFailed'] = result.rejected.some((r) => r.reason === 'UNKNOWN_CODE' || r.reason === 'NOT_ASSIGNED')
    for (const r of result.rejected) offersPreviewRejectionsTotal.inc({ reason: r.reason })
    res.json(result)
  } catch (err) { next(err) }
}

/** Offers worth showing a rider: active automatic offers and anything granted to them. Code offers never appear here. */
export const list: RequestHandler = async (req, res, next) => {
  try {
    // The master switch: nothing is listed, previewed or applied while offers are off.
    if ((await getConfigValue('offers_enabled', 'false')) !== 'true') { res.json({ offers: [] }); return }
    const userId = req.user!.id
    const [active, granted] = await Promise.all([findActiveOffers(), listGrantedOfferIds(userId)])
    const grantedSet = new Set(granted.map(String))
    // The cached list can be up to 30 s old, so judge the window again here.
    const now = Date.now()
    const visible = active
      .filter((o) => (o.startsAt?.getTime() ?? 0) <= now && (o.endsAt?.getTime() ?? Infinity) > now)
      .filter((o) => o.kind === 'auto' || (o.kind === 'assigned' && grantedSet.has(o.id.toString())))
    const usage = await getUserUsage(userId, visible.map((o) => o.id)) // one query for all offers
    const offers = visible
      .filter((o) => o.perUserLimit == null || (usage.get(o.id) ?? 0) < o.perUserLimit)
      .map((o) => ({
        id: o.id.toString(), name: o.name, kind: o.kind, summary: describeOffer({ rules: o.rules, benefit: o.benefit, per_user_limit: o.perUserLimit }),
        endsAt: o.endsAt?.toISOString() ?? null, display: o.display,
      }))
    res.json({ offers })
  } catch (err) { next(err) }
}
