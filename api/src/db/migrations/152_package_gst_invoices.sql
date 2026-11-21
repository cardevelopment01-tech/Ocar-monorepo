-- GST tax invoices to drivers, for the two ways Ocar earns from them:
--   'package'    one invoice per completed ride-credit purchase (GST charged on top of the plan price);
--   'commission' one consolidated invoice per driver per period (monthly by default) for the commission deducted from their wallet on each
--                ride, where the amount cut already includes the GST (the taxable value is backed out of it).
--
-- One gap-free number series per kind per financial year (CGST Rules, Rule 46: a consecutive serial number, at most 16 characters, unique for
-- the financial year). Everything printed on an invoice is copied onto the row when it is issued, so a later change to Ocar's registered
-- address or a driver's profile never rewrites an invoice that was already given out.

CREATE TABLE IF NOT EXISTS invoice_counters (
  series    TEXT    NOT NULL,          -- 'PK' package, 'CM' commission
  fy_code   TEXT    NOT NULL,          -- '2627' for April 2026 - March 2027
  last_seq  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (series, fy_code)
);

CREATE TABLE IF NOT EXISTS driver_invoices (
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind                     TEXT        NOT NULL CHECK (kind IN ('package', 'commission')),
  order_id                 BIGINT      REFERENCES package_purchase_orders(id),   -- package invoices only
  period_start             DATE,                                                  -- commission invoices only (IST, inclusive)
  period_end               DATE,                                                  -- commission invoices only (IST, inclusive)
  driver_id                BIGINT      NOT NULL REFERENCES drivers(id),
  series                   TEXT        NOT NULL,
  invoice_no               VARCHAR(16) NOT NULL,
  fy_code                  TEXT        NOT NULL,
  seq                      INTEGER     NOT NULL,
  issued_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  supplier                 JSONB       NOT NULL,   -- { name, gstin, address, state_code }
  recipient                JSONB       NOT NULL,   -- { name, address, state_name, state_code, phone }
  place_of_supply_code     VARCHAR(2)  NOT NULL,
  sac                      VARCHAR(8)  NOT NULL,
  description              TEXT        NOT NULL,
  taxable_value            NUMERIC(12,2) NOT NULL CHECK (taxable_value > 0),
  cgst_rate                NUMERIC(5,2)  NOT NULL DEFAULT 0,
  cgst_amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst_rate                NUMERIC(5,2)  NOT NULL DEFAULT 0,
  sgst_amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  igst_rate                NUMERIC(5,2)  NOT NULL DEFAULT 0,
  igst_amount              NUMERIC(12,2) NOT NULL DEFAULT 0,
  total                    NUMERIC(12,2) NOT NULL,
  gateway_payment_id       TEXT,
  ride_count               INTEGER,                -- commission invoices: how many rides it covers
  lines                    JSONB,                  -- commission invoices: [{ride_id, date, fare, commission}] annexure
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- the tax lines always add up to the amount the driver paid
  CONSTRAINT driver_invoices_total_chk CHECK (total = taxable_value + cgst_amount + sgst_amount + igst_amount),
  -- intra-state is CGST + SGST, inter-state is IGST: never both
  CONSTRAINT driver_invoices_tax_kind_chk CHECK (igst_amount = 0 OR (cgst_amount = 0 AND sgst_amount = 0)),
  CONSTRAINT driver_invoices_kind_shape_chk CHECK (
    (kind = 'package'    AND order_id IS NOT NULL AND period_start IS NULL) OR
    (kind = 'commission' AND order_id IS NULL AND period_start IS NOT NULL AND period_end IS NOT NULL AND period_end >= period_start)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS driver_invoices_order_uidx   ON driver_invoices (order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS driver_invoices_period_uidx  ON driver_invoices (driver_id, period_start) WHERE kind = 'commission';
CREATE UNIQUE INDEX IF NOT EXISTS driver_invoices_number_uidx  ON driver_invoices (invoice_no);
CREATE UNIQUE INDEX IF NOT EXISTS driver_invoices_series_uidx  ON driver_invoices (series, fy_code, seq);
CREATE INDEX IF NOT EXISTS driver_invoices_driver_idx          ON driver_invoices (driver_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS driver_invoices_issued_idx          ON driver_invoices (issued_at);

-- The commission invoice sweep reads a period of commission debits; this keeps it an index range scan.
CREATE INDEX IF NOT EXISTS driver_wallet_ledger_commission_idx ON driver_wallet_ledger (created_at) WHERE entry_type = 'commission_debit';

-- Ocar's registered details, printed as the supplier. Blank until the super admin fills them in under System config; no invoice is issued
-- while the GSTIN is blank (an invoice without the supplier's GSTIN is not a valid tax invoice).
INSERT INTO system_config (key, value, value_type, description) VALUES
  ('gst_supplier_legal_name',  '',       'string', 'Registered legal name printed on GST invoices as the supplier.'),
  ('gst_supplier_gstin',       '',       'string', 'Ocar''s 15-character GSTIN. Driver GST invoices are not issued until this is set.'),
  ('gst_supplier_address',     '',       'string', 'Registered address printed on GST invoices.'),
  ('gst_supplier_state_code',  '21',     'string', 'Two-digit GST state code of the supplier registration (21 = Odisha).'),
  ('gst_invoice_sac',          '998319',  'string', 'SAC (service accounting code) printed on ride-credit plan invoices. Confirm with the CA before the first invoice.'),
  ('gst_commission_sac',       '998319',  'string', 'SAC printed on commission invoices. Confirm with the CA before the first invoice.'),
  ('commission_gst_percent',   '18',     'decimal', 'GST included in the commission deducted per ride (percent). The commission amount is tax-inclusive: taxable value = amount / (1 + this/100).'),
  ('commission_invoice_period','monthly', 'string', 'How often a driver gets a consolidated commission invoice: monthly (previous calendar month) or weekly (previous Monday to Sunday).')
ON CONFLICT (key) DO NOTHING;
