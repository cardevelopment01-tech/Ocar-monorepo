import { pool } from '@/db/client'
import * as repo from './safety.repository'
import type { CreateDisputeInput, ResolveDisputeInput } from './safety.types'
import * as geoService from '@/modules/geo/geo.service'
import { assertRideParticipant } from './safety.guards'

export async function createDispute(input: CreateDisputeInput) {
  const ride = await repo.getRideBasic(input.rideId)
  if (!ride) {
    throw Object.assign(new Error('Ride not found'), { httpStatus: 404 })
  }
  if (ride.status !== 'completed') {
    throw Object.assign(new Error('Disputes can only be raised on completed rides'), {
      httpStatus: 400, code: 'RIDE_NOT_COMPLETED',
    })
  }

  const principal: { role: 'user' | 'driver'; id: bigint } =
    input.initiatedByUserId != null
      ? { role: 'user', id: input.initiatedByUserId }
      : { role: 'driver', id: input.initiatedByDriverId! }
  assertRideParticipant(ride, principal)

  const slaHours = input.priority && input.priority <= 2 ? 24 : 48

  const dispute = await repo.insertDispute({
    ride_id:             input.rideId,
    initiator:           input.initiator,
    initiated_by_user:   input.initiatedByUserId   ?? null,
    initiated_by_driver: input.initiatedByDriverId ?? null,
    type:                input.type,
    description:         input.description,
    priority:            input.priority             ?? 2,
    sla_hours:           slaHours,
  })

  return dispute
}

export async function listDisputes(opts: {
  status?:     string
  assignedTo?: bigint
  limit:       number
  offset:      number
}) {
  return repo.getDisputes(opts)
}

export async function getDispute(id: bigint) {
  const dispute = await repo.getDisputeById(id)
  if (!dispute) throw Object.assign(new Error('Dispute not found'), { httpStatus: 404 })
  const actions = await repo.getDisputeActions(id)
  return { ...dispute, actions }
}

export async function assignDispute(id: bigint, adminId: bigint) {
  const dispute = await repo.getDisputeById(id)
  if (!dispute) throw Object.assign(new Error('Dispute not found'), { httpStatus: 404 })

  const updated = await repo.updateDisputeStatus(id, 'under_review', adminId)

  await repo.insertDisputeAction({
    dispute_id:  id,
    admin_id:    adminId,
    action_type: 'assigned',
    note:        null,
  })

  return updated
}

export async function resolveDispute(id: bigint, input: ResolveDisputeInput) {
  const dispute = await repo.getDisputeById(id)
  if (!dispute) throw Object.assign(new Error('Dispute not found'), { httpStatus: 404 })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE disputes
       SET status = 'resolved', outcome = $2, outcome_note = $3,
           resolved_by = $4, resolved_at = now(), updated_at = now()
       WHERE id = $1`,
      [id, input.outcome, input.note, input.adminId]
    )

    await client.query(
      `INSERT INTO dispute_actions (dispute_id, admin_id, action_type, note)
       VALUES ($1,$2,'resolved',$3)`,
      [id, input.adminId, input.note]
    )

    if (
      input.refundAmount &&
      input.refundAmount > 0 &&
      (input.outcome === 'full_refund' || input.outcome === 'partial_refund' || input.outcome === 'fare_adjusted')
    ) {
      const payRes = await client.query(
        `SELECT id FROM payments WHERE ride_id = $1 LIMIT 1`,
        [dispute.ride_id]
      )
      const payment = payRes.rows[0]
      if (payment) {
        await client.query(
          `INSERT INTO refunds
             (payment_id, ride_id, dispute_id, amount, reason, status, initiated_by)
           VALUES ($1,$2,$3,$4,$5,'requested',$6)`,
          [
            payment.id, dispute.ride_id, id,
            input.refundAmount, input.note, input.adminId,
          ]
        )
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  return repo.getDisputeById(id)
}

export async function getTripReplay(id: bigint) {
  const dispute = await repo.getDisputeById(id)
  if (!dispute) throw Object.assign(new Error('Dispute not found'), { httpStatus: 404 })

  const actualTrail = await repo.getGpsTrailForRide(dispute.ride_id)

  let plannedRoute: { polyline: string } | null = null
  if (
    dispute.origin_lat != null && dispute.origin_lng != null &&
    dispute.destination_lat != null && dispute.destination_lng != null
  ) {
    try {
      const route = await geoService.getRoute(
        dispute.origin_lat, dispute.origin_lng,
        dispute.destination_lat, dispute.destination_lng
      )
      plannedRoute = { polyline: route.polyline }
    } catch {
      // Planned-route overlay is a nice-to-have on top of the actual trail —
      // a Google Directions API failure shouldn't block replay of the trail itself.
      plannedRoute = null
    }
  }

  return { actualTrail, plannedRoute }
}
