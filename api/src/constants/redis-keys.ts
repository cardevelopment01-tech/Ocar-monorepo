export const rideAckKey = (rideId: string, driverId: string): string =>
  `ride:ack:${rideId}:${driverId}`

export const startOtpKey = (rideId: string): string => `ride:start_otp:${rideId}`
