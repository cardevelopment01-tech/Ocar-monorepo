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

  const rating = await repo.insertRating({
    ride_id:        input.rideId,
    direction:      input.direction,
    score:          input.score,
    from_user_id:   input.fromUserId   ?? null,
    from_driver_id: input.fromDriverId ?? null,
    to_user_id:     input.toUserId     ?? null,
    to_driver_id:   input.toDriverId   ?? null,
    comment:        input.comment      ?? null,
  })

  if (input.tagIds && input.tagIds.length > 0) {
    await repo.insertRatingTags(BigInt(rating.id), input.tagIds)
  }

  if (input.direction === 'user_to_driver' && input.toDriverId) {
    await repo.updateDriverRatingAvg(input.toDriverId)
  } else if (input.direction === 'driver_to_user' && input.toUserId) {
    await repo.updateUserRatingAvg(input.toUserId)
  }

  return rating
}
