import DriverProfileSkeleton from './DriverProfileSkeleton'

// Shown the instant a driver is clicked, while Next fetches this dynamic route. Without it the list sat unchanged until the server
// answered; with it the click feels immediate.
export default function DriverProfileLoading() {
  return <DriverProfileSkeleton />
}
