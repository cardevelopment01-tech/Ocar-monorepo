export type RatingDirection = 'user_to_driver' | 'driver_to_user'
export type SosSeverity    = 'low' | 'medium' | 'high'
export type SosStatus      = 'triggered' | 'acknowledged' | 'responding' | 'resolved' | 'false_alarm'
export type DisputeStatus  = 'open' | 'under_review' | 'pending_info' | 'resolved' | 'escalated' | 'withdrawn'
export type DisputeOutcome =
  | 'no_action' | 'fare_adjusted' | 'full_refund' | 'partial_refund'
  | 'driver_warned' | 'driver_suspended' | 'driver_banned'
  | 'user_warned' | 'user_suspended' | 'item_recovered'

export interface SubmitRatingInput {
  rideId:         bigint
  direction:      RatingDirection
  score:          number
  comment?:       string
  tagIds?:        bigint[]
  fromUserId?:    bigint
  fromDriverId?:  bigint
  toUserId?:      bigint
  toDriverId?:    bigint
}

export interface TriggerSosInput {
  rideId:              bigint
  severity?:           SosSeverity
  lat?:                number
  lng?:                number
  notes?:              string
  triggeredByUserId?:  bigint
  triggeredByDriverId?: bigint
}

export interface CreateDisputeInput {
  rideId:             bigint
  type:               string
  description:        string
  priority?:          number
  initiator:          'user' | 'driver'
  initiatedByUserId?: bigint
  initiatedByDriverId?: bigint
}

export interface ResolveDisputeInput {
  outcome:       DisputeOutcome
  note:          string
  refundAmount?: number
  adminId:       bigint
}
