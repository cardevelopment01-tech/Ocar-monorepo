export type RideParticipantType = 'user' | 'driver'

// Row shape as returned to clients: all bigint ids serialised to strings,
// timestamps to ISO strings (frontend consumes strings, never JS bigint).
export interface RideMessageDTO {
  id: string
  rideId: string
  senderType: RideParticipantType
  senderId: string
  body: string
  clientMsgId: string
  readAt: string | null
  createdAt: string
}

export interface SendMessageInput {
  rideId: bigint
  senderType: RideParticipantType
  senderId: bigint
  body: string
  clientMsgId: string
}

// Caller identity resolved by the controller from req.user / req.driver.
export interface ChatCaller {
  userId?: bigint
  driverId?: bigint
}
