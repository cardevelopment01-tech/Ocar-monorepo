export const rideAckKey = (rideId: string, driverId: string): string =>
  `ride:ack:${rideId}:${driverId}`
