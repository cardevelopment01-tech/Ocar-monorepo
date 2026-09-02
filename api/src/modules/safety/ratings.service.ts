import * as repo from './safety.repository'
import type { SubmitRatingInput } from './safety.types'
import { assertRideParticipant } from './safety.guards'
import { httpError } from '@/lib/errors'

export async function getRatingTags(direction: 'user_to_driver' | 'driver_to_user') {
  const appliesTo = direction === 'user_to_driver' ? 'driver' : 'user'
  return repo.getTagDefinitions(appliesTo)
}

export async function submitRating(input: SubmitRatingInput) {
  const ride = await repo.getRideBasic(input.rideId)
  if (!ride) {
    throw httpError(404, 'Ride not found', 'RIDE_NOT_FOUND')
  }
  if (ride.status !== 'completed') {
    throw httpError(400, 'Ride must be completed before rating', 'RIDE_NOT_COMPLETED')
  }

  const duplicate = await repo.ratingExists(input.rideId, input.direction)
  if (duplicate) {
    throw httpError(409, 'Rating already submitted for this ride', 'RATING_ALREADY_EXISTS')
  }

  // Auth-presence check stays here (401 = no principal on the request);
  // the participant check itself is the shared guard (403).
  const principal: { role: 'user' | 'driver'; id: bigint } | null =
    input.direction === 'user_to_driver'
      ? (input.fromUserId ? { role: 'user', id: input.fromUserId } : null)
      : (input.fromDriverId ? { role: 'driver', id: input.fromDriverId } : null)
  if (!principal) {
    const authErrorMessage = input.direction === 'user_to_driver' ? 'User auth required' : 'Driver auth required'
    throw httpError(401, authErrorMessage, 'AUTH_REQUIRED')
  }
  assertRideParticipant(ride, principal)

  // to_user_id/to_driver_id are derived from the verified ride row, never
  // taken from client input — the ride's user_id/driver_id are the only
  // trustworthy source for who is being rated.
  const toDriverId = input.direction === 'user_to_driver' ? BigInt(ride.driver_id) : null
  const toUserId   = input.direction === 'driver_to_user' ? BigInt(ride.user_id)   : null

  const rating = await repo.insertRating({
    ride_id:        input.rideId,
    direction:      input.direction,
    score:          input.score,
    from_user_id:   input.fromUserId   ?? null,
    from_driver_id: input.fromDriverId ?? null,
    to_user_id:     toUserId,
    to_driver_id:   toDriverId,
    comment:        input.comment      ?? null,
  })

  if (input.tagIds && input.tagIds.length > 0) {
    await repo.insertRatingTags(BigInt(rating.id), input.tagIds)
  }

  if (toDriverId) {
    await repo.updateDriverRatingAvg(toDriverId, input.score)
  } else if (toUserId) {
    await repo.updateUserRatingAvg(toUserId, input.score)
  }

  return rating
}
