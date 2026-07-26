import * as repo from './safety.repository'
import type { SubmitRatingInput } from './safety.types'

export async function getRatingTags(direction: 'user_to_driver' | 'driver_to_user') {
  const appliesTo = direction === 'user_to_driver' ? 'driver' : 'user'
  return repo.getTagDefinitions(appliesTo)
}

export async function submitRating(input: SubmitRatingInput) {
  const ride = await repo.getRideBasic(input.rideId)
  if (!ride) {
    throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  }
  if (ride.status !== 'completed') {
    throw Object.assign(new Error('Ride must be completed before rating'), { httpStatus: 400, code: 'RIDE_NOT_COMPLETED' })
  }

  const duplicate = await repo.ratingExists(input.rideId, input.direction)
  if (duplicate) {
    throw Object.assign(new Error('Rating already submitted for this ride'), { httpStatus: 409, code: 'RATING_ALREADY_EXISTS' })
  }

  if (input.direction === 'user_to_driver') {
    if (!input.fromUserId) throw Object.assign(new Error('User auth required'), { httpStatus: 401 })
    if (BigInt(ride.user_id) !== input.fromUserId) {
      throw Object.assign(new Error('Not the user for this ride'), { httpStatus: 403 })
    }
  } else {
    if (!input.fromDriverId) throw Object.assign(new Error('Driver auth required'), { httpStatus: 401 })
    if (BigInt(ride.driver_id) !== input.fromDriverId) {
      throw Object.assign(new Error('Not the driver for this ride'), { httpStatus: 403 })
    }
  }

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
