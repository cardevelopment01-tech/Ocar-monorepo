// The single ride-ownership rule for the safety module. SOS, disputes, and
// ratings all route their "is this caller party to this ride?" check through
// here so the three cannot drift (they did before — ratings enforced it,
// SOS/disputes did not: an IDOR gap, see 2026-08-24 hardening design §03.1).

export interface RideParties {
  user_id: bigint | number | string | null
  driver_id: bigint | number | string | null
}

export interface RidePrincipal {
  role: 'user' | 'driver'
  id: bigint
}

export function assertRideParticipant(ride: RideParties, principal: RidePrincipal): void {
  const isParticipant =
    (principal.role === 'user' && ride.user_id != null && BigInt(ride.user_id) === principal.id) ||
    (principal.role === 'driver' && ride.driver_id != null && BigInt(ride.driver_id) === principal.id)

  if (!isParticipant) {
    throw Object.assign(new Error('You are not a participant on this ride.'), {
      httpStatus: 403,
      code: 'NOT_RIDE_PARTICIPANT',
    })
  }
}
