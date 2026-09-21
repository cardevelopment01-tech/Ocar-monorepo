export function createSingleFlightGuard() {
  let inFlight = false
  return {
    get inFlight() { return inFlight },
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (inFlight) return undefined
      inFlight = true
      try {
        return await fn()
      } finally {
        inFlight = false
      }
    },
  }
}
