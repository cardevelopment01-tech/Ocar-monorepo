-- Driver identity verification (PR1/3): enum values for the re-verification rows added in a later PR.
-- ALTER TYPE ... ADD VALUE is kept in its own file: migrate.ts wraps each file in BEGIN/COMMIT and a new enum value
-- cannot be used in the transaction that adds it (same precedent as 025, 031 and 047).
ALTER TYPE verification_kind ADD VALUE IF NOT EXISTS 'spot_selfie';
ALTER TYPE verification_kind ADD VALUE IF NOT EXISTS 'spot_plate';
