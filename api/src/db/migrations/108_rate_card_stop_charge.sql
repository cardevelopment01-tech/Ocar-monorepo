-- ============================================================
-- Per-stop charge, sourced from rate cards
-- ------------------------------------------------------------
-- The flat fee for an added stop lived in a separate per-category table
-- (stop_charges, 006) that no admin screen could edit, and was applied to
-- round trips only. Move it onto rate_cards so it is versioned, city-scoped
-- and editable through the same admin flow as every other rate (new row,
-- effective_to on the old one; see 078 and 095).
--
-- 0 = stops are free. NOT NULL DEFAULT 0 so a new rate card is free unless an
-- admin sets a price. Any ride type may carry a charge (one_way, round_trip,
-- rental); only round trips used to.
--
-- Backward compatible: the previous release never reads or writes the column (its inserts take
-- the DEFAULT) and keeps reading stop_charges, which is left in place.
-- ============================================================

-- One guarded block, so re-running it (or applying it to a DB that already has the column) can
-- never overwrite a stop price an admin has since set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'rate_cards' AND column_name = 'stop_charge'
  ) THEN
    ALTER TABLE rate_cards
      ADD COLUMN stop_charge NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (stop_charge >= 0);

    COMMENT ON COLUMN rate_cards.stop_charge IS
      'Flat fee per stop added to a ride billed on this rate card. 0 = stops are free. Captured per stop at add time (ride_stops.stop_charge_applied), so changing it never reprices an existing stop.';

    -- Keep today's behaviour: round trips were charged stop_charges.charge_per_stop, so carry that
    -- value onto round-trip cards (current AND historical, so a receipt rebuilt from an old card
    -- agrees). one_way / rental were never charged -> stay 0.
    -- migration-check: allow rate-cards one-off backfill of the brand-new stop_charge column; no existing rate is changed
    UPDATE rate_cards rc
       SET stop_charge = sc.charge_per_stop
      FROM stop_charges sc
     WHERE sc.category_id = rc.category_id
       AND rc.ride_type = 'round_trip';
  END IF;
END $$;

ALTER TABLE rate_card_history
  ADD COLUMN IF NOT EXISTS stop_charge NUMERIC(8,2) NULL;

-- stop_charges is no longer read by the app. Left in place (not dropped) so rolling back to the
-- previous release works.
COMMENT ON TABLE stop_charges IS
  'DEPRECATED (108): per-stop charge now lives on rate_cards.stop_charge. Not read by the app.';
