/** Round to paise without the 33.335 -> 33.33 float trap (33.335 * 100 is 3333.4999999999995). */
export function roundPaise(n: number): number {
  return Math.round(Number((n * 100).toPrecision(12))) / 100
}

export function sumComponents(fare: Record<string, number>, keys?: string[]): number {
  const ks = keys ?? Object.keys(fare)
  return ks.reduce((s, k) => s + (fare[k] ?? 0), 0)
}
