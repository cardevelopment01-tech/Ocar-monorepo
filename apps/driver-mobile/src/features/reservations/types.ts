// Mirrors GET /api/v1/rides/reservations (api/src/modules/rides/reservation.service.ts, DriverReservation): bookings an admin reserved for this driver.
export type Reservation = {
  rideId: string
  pickupAt: string
  pickup: string | null
  drop: string | null
  rideType: string
  isReturnCab: boolean
  estimatedFare: number | null
  confirmed: boolean
  confirmBy: string
  readyBy: string
  canConfirm: boolean
  // Giving the booking back now is inside the last hour: ops are told, and it counts as a late hand-back.
  handBackIsLate: boolean
}
