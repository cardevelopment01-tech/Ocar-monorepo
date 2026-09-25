// A stored pick can go stale (e.g. switching one-way -> round-trip hides a
// category with no rate card) -- fall back to the first visible card so Book
// never sits disabled with nothing highlighted.
export function resolveSelectedCategory<Id>(visibleIds: readonly Id[], storedId: Id | null): Id | null {
  if (storedId != null && visibleIds.includes(storedId)) return storedId
  return visibleIds[0] ?? null
}
