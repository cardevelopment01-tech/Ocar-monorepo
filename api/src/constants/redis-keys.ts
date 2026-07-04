export const rideAckKey = (rideId: string, driverId: string): string =>
  `ride:ack:${rideId}:${driverId}`

export const startOtpKey = (rideId: string): string => `ride:start_otp:${rideId}`
export const endOtpKey   = (rideId: string): string => `ride:end_otp:${rideId}`
