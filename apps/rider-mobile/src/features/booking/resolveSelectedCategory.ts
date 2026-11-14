// A stored pick can go stale (e.g. switching one-way -> round-trip hides a
// category with no rate card) -- fall back to the first visible card so Book
// never sits disabled with nothing highlighted. `unavailableIds` are cards that are shown but cannot be booked right
// now (no cars nearby): a pick that is one of them is treated as stale too, and the fallback is the first card that
// can actually be booked (the first visible one only when none can).
export function resolveSelectedCategory<Id>(visibleIds: readonly Id[], storedId: Id | null, unavailableIds: readonly Id[] = []): Id | null {
  const ok = (id: Id) => !unavailableIds.includes(id)
  if (storedId != null && visibleIds.includes(storedId) && ok(storedId)) return storedId
  return visibleIds.find(ok) ?? visibleIds[0] ?? null
}
