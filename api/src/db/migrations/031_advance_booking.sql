-- ============================================================
-- M07 EXT: ADVANCE BOOKING (part 1 — enum additions)
-- Split from the table/index migration because Postgres forbids using a
-- newly added enum value inside the same transaction that added it.
-- See docs/ADVANCE_BOOKING_PLAN.md.
-- ============================================================

-- 'scheduled' rides sit idle until the dispatch sweep/job flips them to
-- 'requested' and hands off to the existing (unmodified) broadcast pipeline.
ALTER TYPE ride_status ADD VALUE 'scheduled' BEFORE 'requested';

-- Cancelling a ride that never reached dispatch (no driver work happened yet)
-- is a distinct, always-free cancellation stage.
ALTER TYPE cancel_stage ADD VALUE 'before_dispatch';
