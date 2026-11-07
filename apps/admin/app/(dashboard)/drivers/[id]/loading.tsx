// Shown the instant a driver is clicked, while Next fetches this dynamic route. Without it the list sat unchanged until the server
// answered; with it the click feels immediate. Same bars as the page's own first-load state, so the swap to the real page does not jump.
export default function DriverProfileLoading() {
  return (
    <div className="p-6 space-y-4" aria-busy="true" aria-label="Loading driver">
      {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-6 bg-surface-2 rounded animate-pulse" />)}
    </div>
  )
}
