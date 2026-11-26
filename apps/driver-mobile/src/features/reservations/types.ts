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
  // Where the pickup is (for Navigate), and how long the drive is from the driver's last known position (null when unknown).
  pickupLat: number | null
  pickupLng: number | null
  driveMin: number | null
  // The time to set off, and when the booking goes live and the ride opens by itself (ISO).
  leaveBy: string
  opensAt: string
}
