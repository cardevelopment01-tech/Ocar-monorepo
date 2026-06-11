-- Add docs_rejected status so admin can return documents to driver for resubmission
-- without permanently banning them. Driver can fix and resubmit from this state.
ALTER TYPE driver_status ADD VALUE IF NOT EXISTS 'docs_rejected';
