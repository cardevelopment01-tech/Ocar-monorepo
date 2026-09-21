import type { RideHistoryItem } from '@ocar/mobile-shared'
import type { HistoryTab } from './types'

// Pulled out of RideHistoryList so the tab-filter rule is independently
// testable -- matches web's history/page.tsx filtering the current fetched
// page client-side (tab==='all' ? rides : rides.filter(status===tab)).
export function filterRidesByTab(rides: RideHistoryItem[], tab: HistoryTab): RideHistoryItem[] {
  if (tab === 'upcoming' || tab === 'all') return rides
  return rides.filter((r) => r.status === tab)
}
