-- Separate the driver's *claimed* document expiry (taken verbatim from the upload
-- request body, untrusted) from the platform-*verified* expiry an admin sets at
-- approval time. All gating (hasApprovedRequiredDocs, the broadcast candidate
-- queries, expiry reminders) reads verified_valid_until ONLY — claimed_valid_until
-- becomes informational, shown to the admin reviewer as a cross-check, never trusted.

ALTER TABLE driver_documents RENAME COLUMN valid_until TO claimed_valid_until;
ALTER TABLE driver_documents ADD COLUMN verified_valid_until DATE;

ALTER TABLE driver_vehicle_documents RENAME COLUMN valid_until TO claimed_valid_until;
ALTER TABLE driver_vehicle_documents ADD COLUMN verified_valid_until DATE;

-- Backfill: existing approved rows were implicitly accepted at their claimed expiry
-- under the old schema. Without this, every already-approved doc would have a NULL
-- verified_valid_until and so read as "never expires" (NULL < CURRENT_DATE is NULL),
-- silently un-expiring currently-active drivers. Copy claimed -> verified for approved
-- rows only; pending/rejected rows stay NULL and must be set at (re-)approval.
UPDATE driver_documents
  SET verified_valid_until = claimed_valid_until
  WHERE status = 'approved' AND claimed_valid_until IS NOT NULL;
UPDATE driver_vehicle_documents
  SET verified_valid_until = claimed_valid_until
  WHERE status = 'approved' AND claimed_valid_until IS NOT NULL;
