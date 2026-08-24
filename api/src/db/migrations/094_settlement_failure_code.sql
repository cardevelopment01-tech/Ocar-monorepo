-- 094: store a mapped, safe failure code on settlements instead of the raw
-- RazorpayX error body. Full gateway detail (status + body) now lives only in
-- structured Pino/Loki logs — never in a column the admin API returns.
-- failure_reason is retained for historical rows but is no longer written to.
ALTER TABLE settlements ADD COLUMN failure_code TEXT NULL;
