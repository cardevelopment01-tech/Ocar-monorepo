-- 139_tax_deductions_pan_text.sql
-- tax_deductions.pan_at_deduction was VARCHAR(10), sized for a plain PAN, but the 194-O insert in settlements.service.ts copies
-- driver_tax_profile.pan_enc into it, and that is the AES-GCM encrypted value ("iv:tag:data" in hex, about 78 characters). For a driver
-- with a PAN on file the insert fails with "value too long", and it runs inside the payment-confirm transaction. No row has ever been
-- written (prd has 0 tax_deductions rows), so the bug has not fired yet; it will once a PAN driver is paid for an online or wallet ride.
--
-- Widening VARCHAR(10) to TEXT is a catalog-only change in Postgres (no table rewrite, no new check), and old API nodes keep working
-- during the blue/green overlap: they write the same values. Nothing else changes.
--
-- lock_timeout makes the migration fail fast (and the deploy retry) instead of queueing behind a long transaction.
SET LOCAL lock_timeout = '10s';

-- migration-check: allow alter-type widening varchar(10) to text is metadata-only (no rewrite) and old nodes write the same values
ALTER TABLE tax_deductions ALTER COLUMN pan_at_deduction TYPE TEXT;
