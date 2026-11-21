// Whether the rider can still add a stop to a ride. The server sends each ride's own limit as `maxStops` (a city ride has a lower one than
// other rides, set in System config), so the app never guesses it; an older server omits it and the button stays, with the server's refusal
// shown if the rider goes over. The count includes skipped stops, as the server counts them.
export function stopsFull(stopCount: number, maxStops: number | null | undefined): boolean {
  return typeof maxStops === 'number' && stopCount >= maxStops
}
