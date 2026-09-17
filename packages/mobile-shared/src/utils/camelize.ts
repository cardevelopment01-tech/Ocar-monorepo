// Backend responses (rides/geo/pricing) are snake_case (DB column names passed through
// directly, mirrored in apps/user/lib/ride-api.ts). mobile-shared's types are camelCase
// to match its existing convention (TokenPair, ApiError). Call this once at the API
// client boundary rather than renaming fields by hand per call site.
export function camelizeKeys<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camelizeKeys(v)) as unknown as T
  if (value === null || typeof value !== 'object') return value as T
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const camelKey = key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
    out[camelKey] = camelizeKeys(val)
  }
  return out as T
}
