# ADR-001: BullMQ over AWS SQS

**Status:** Accepted

## Context

The platform needs async job processing for:
- Ride broadcast fan-out (offer sent to up to 5 drivers per round, 3 rounds, 15–20s TTL per offer)
- GPS batch writes (30s flush interval, ~450k rows/day at scale)
- Nightly driver settlements
- Advance booking dispatch (15 min before pickup)
- Partition pre-creation (monthly, 1 day before month rollover)

## Decision

Use BullMQ backed by managed Redis (Upstash in production, local Redis in development).

## Reasons

**Native fan-out.** One job fans to N driver queues using BullMQ's `addBulk`. SQS requires SQS + SNS + Lambda to achieve the same result — three services, three billing dimensions, higher operational complexity.

**Priority queues.** SOS alerts must be processed before all other jobs. BullMQ supports per-job priority natively (`priority: 1`). SQS has no native priority support; you'd need separate queues and a routing layer.

**Per-job TTL.** Broadcast offers expire in 15–20 seconds — after that the driver window closes and the job is irrelevant. BullMQ supports `removeOnComplete` and job expiry natively. SQS visibility timeout is a poor substitute.

**Sub-millisecond latency.** BullMQ via Redis delivers jobs in <1ms. SQS long-polling has a minimum 20–200ms round-trip, which is too slow for broadcast rounds where the entire window is 20 seconds.

**Redis already in stack.** Redis is required for OTP storage, GPS buffering, and session caching. BullMQ reuses the same Redis instance — no additional infrastructure dependency.

**Bull Board UI.** Job monitoring dashboard (`@bull-board/express`) works with zero additional setup and provides visibility into queue depths, failed jobs, and retry state.

## Tradeoffs

- Requires a persistent Redis instance (`appendonly yes`). Managed options: Upstash (~$0/month for low volume, pay-per-request), ElastiCache (~$20/month for cache.t3.micro).
- Redis is a single point of failure for the job system. Mitigated by managed Redis with replication.
- BullMQ jobs are lost if Redis loses data before a worker picks them up. Mitigated by `appendonly yes` and managed Redis backups for critical jobs (settlements, dispatch).

## Migration Path

If scale demands it, switch to Redis Cluster mode. BullMQ supports cluster natively via `ioredis` Cluster client — no application-level code changes required.
