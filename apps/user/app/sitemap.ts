import type { MetadataRoute } from 'next'

const BASE = 'https://ocarindia.com'
const PATHS = [
  '/',
  '/pricing',
  '/about',
  '/contact',
  '/legal',
  '/legal/terms',
  '/legal/privacy',
  '/legal/refund-cancellation',
  '/legal/shipping',
  '/legal/delete-account',
]

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((p) => ({ url: `${BASE}${p}`, changeFrequency: 'monthly', priority: p === '/' ? 1 : 0.6 }))
}
