import type { Waypoint } from '@googlemaps/react-native-navigation-sdk'

// A pickup, stop or drop is a curb stop, not a point to drive through. Without these hints Google picks the
// side of the road itself, and on a divided or narrow road the car ends up opposite the rider (the "rider is
// on my left but the app says right" report). preferSameSideOfRoad arrives on the waypoint's side;
// vehicleStopover moves the point to a legal stopping spot nearby when one exists.
export function curbWaypoint(lat: number, lng: number): Waypoint {
  return { position: { lat, lng }, preferSameSideOfRoad: true, vehicleStopover: true }
}
