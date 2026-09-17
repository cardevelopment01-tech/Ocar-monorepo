export type SessionCheckState = 'checking' | 'ready' | 'failed'

// Pure decision, extracted for testing: the "Go Online" button must stay disabled
// until the initial GET /sessions/current check resolves -- eliminates the race
// against a concurrent POST /sessions/online by construction (the check always
// completes before the button is ever tappable) rather than by reconciling
// whichever response lands last.
export function canTapGoOnline(sessionCheck: SessionCheckState, isOnline: boolean, goingOnline: boolean): boolean {
  return sessionCheck === 'ready' && !isOnline && !goingOnline
}
