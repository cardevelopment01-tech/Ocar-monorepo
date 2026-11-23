-- Admin invites: did the email actually go out, and when was the current link issued.
-- Expand only (backward compatible): new columns with defaults, nothing read or dropped. The previous release ignores them.
--   email_status: 'unknown' for invites sent before this existed, then 'queued' -> 'sent' | 'failed' as the email job runs.
--   email_error:  why it failed, in the mail server's own words (shown to super admins only), so "the email never arrived" has an answer.
--   link_issued_at: when the current link was created (an invite, or a resend). A resend replaces the link, and waits a minute between sends.

ALTER TABLE admin_invites
  ADD COLUMN IF NOT EXISTS email_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (email_status IN ('unknown', 'queued', 'sent', 'failed')),
  ADD COLUMN IF NOT EXISTS email_error TEXT,
  ADD COLUMN IF NOT EXISTS email_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS link_issued_at TIMESTAMPTZ NOT NULL DEFAULT now();
