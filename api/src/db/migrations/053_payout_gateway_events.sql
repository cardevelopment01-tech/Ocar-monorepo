-- Add RazorpayX payout webhook event types to the gateway event enum.
ALTER TYPE gateway_event_type ADD VALUE IF NOT EXISTS 'payout_processed';
ALTER TYPE gateway_event_type ADD VALUE IF NOT EXISTS 'payout_failed';
ALTER TYPE gateway_event_type ADD VALUE IF NOT EXISTS 'payout_reversed';
