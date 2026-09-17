import { useEffect, useState } from 'react'

// 300ms per the plan's Design-phase interaction-state table (pickup/drop
// picker row): long enough that the skeleton list doesn't flash on every
// keystroke, short enough to still feel live.
export const AUTOCOMPLETE_DEBOUNCE_MS = 300

export function useDebouncedValue<T>(value: T, delayMs: number = AUTOCOMPLETE_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
