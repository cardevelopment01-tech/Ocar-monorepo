-- All application enums for the Ocar platform
-- Values must stay in sync with src/constants/enums.ts

-- Shared across users/drivers/admins
CREATE TYPE principal_role AS ENUM ('user', 'driver', 'admin');

-- Users
CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');

-- Drivers
CREATE TYPE driver_status AS ENUM (
  'pending_docs', 'pending_approval', 'active', 'suspended', 'banned'
);

-- Admins
CREATE TYPE admin_role AS ENUM (
  'super_admin', 'ops_admin', 'support_admin', 'finance_admin'
);

-- OTP
CREATE TYPE otp_purpose AS ENUM (
  'login', 'trip_start', 'trip_end', 'account_deletion'
);

-- Documents
CREATE TYPE doc_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE doc_type AS ENUM (
  'driving_license', 'id_proof',
  'profile_photo', 'aadhaar_front', 'aadhaar_back'
);

-- Daily verification
CREATE TYPE verification_kind AS ENUM ('daily_selfie', 'daily_plate');
CREATE TYPE verification_status AS ENUM (
  'pending', 'passed', 'failed', 'auto_passed'
);

-- Driver mode (session type)
CREATE TYPE drive_mode AS ENUM ('standard', 'return_cab');
CREATE TYPE session_state AS ENUM ('online', 'on_trip', 'offline');

-- Vehicles
CREATE TYPE vehicle_state AS ENUM (
  'pending', 'active', 'inactive', 'blacklisted'
);
CREATE TYPE driver_vehicle_doc_type AS ENUM (
  'vehicle_rc', 'insurance', 'permit', 'pollution_cert', 'fitness_cert'
);

-- Geo
CREATE TYPE zone_type AS ENUM ('city', 'highway', 'expressway');
CREATE TYPE city_status AS ENUM ('draft', 'active', 'inactive');

-- Pricing
CREATE TYPE ride_type AS ENUM ('one_way', 'round_trip', 'rental');
CREATE TYPE fare_status AS ENUM ('estimate', 'final', 'disputed', 'refunded');
CREATE TYPE surge_status AS ENUM (
  'scheduled', 'active', 'expired', 'cancelled'
);

-- Rides
CREATE TYPE ride_status AS ENUM (
  'requested', 'accepted', 'driver_arrived',
  'in_progress', 'completed', 'cancelled', 'no_drivers'
);
CREATE TYPE transition_actor AS ENUM (
  'user', 'driver', 'system', 'admin', 'ride_completion', 'timeout'
);
CREATE TYPE assignment_status AS ENUM (
  'offered', 'accepted', 'declined', 'expired', 'cancelled'
);
CREATE TYPE stop_status AS ENUM ('pending', 'reached', 'skipped');
CREATE TYPE ride_otp_type AS ENUM ('trip_start', 'trip_end');
CREATE TYPE cancel_actor AS ENUM ('user', 'driver', 'admin', 'system');
CREATE TYPE cancel_stage AS ENUM (
  'before_acceptance', 'after_acceptance', 'after_arrival', 'in_progress'
);
CREATE TYPE advance_booking_status AS ENUM (
  'pending_driver', 'driver_confirmed', 'dispatched', 'completed', 'cancelled'
);

-- Payments
CREATE TYPE payment_channel AS ENUM (
  'cash_direct', 'company_qr', 'online_wallet',
  'online_upi', 'online_card', 'platform_wallet'
);
CREATE TYPE payment_status AS ENUM (
  'pending', 'processing', 'completed', 'failed',
  'refunded', 'partially_refunded', 'disputed'
);
CREATE TYPE gateway_event_type AS ENUM (
  'order_created', 'payment_authorized', 'payment_captured',
  'payment_failed', 'refund_created', 'refund_processed',
  'refund_failed', 'dispute_created', 'dispute_resolved'
);
CREATE TYPE settlement_status AS ENUM (
  'pending', 'processing', 'completed', 'failed', 'on_hold'
);
CREATE TYPE refund_status AS ENUM (
  'requested', 'approved', 'processing', 'completed', 'failed'
);
CREATE TYPE ledger_entry_type AS ENUM (
  'ride_earning', 'settlement_debit', 'cancellation_fee',
  'adjustment_credit', 'adjustment_debit', 'commission_debit'
);

-- Safety
CREATE TYPE rating_direction AS ENUM ('user_to_driver', 'driver_to_user');
CREATE TYPE tag_sentiment AS ENUM ('positive', 'negative', 'neutral');
CREATE TYPE tag_applies_to AS ENUM ('driver', 'user', 'both');
CREATE TYPE sos_severity AS ENUM ('low', 'medium', 'high');
CREATE TYPE sos_status AS ENUM (
  'triggered', 'acknowledged', 'responding', 'resolved', 'false_alarm'
);
CREATE TYPE notification_channel AS ENUM ('sms', 'call', 'push', 'whatsapp');
CREATE TYPE notification_delivery AS ENUM (
  'sent', 'delivered', 'failed', 'no_response'
);
CREATE TYPE dispute_type AS ENUM (
  'fare_overcharge', 'driver_behaviour', 'vehicle_condition',
  'lost_item', 'trip_manipulation', 'payment_issue',
  'safety_incident', 'other'
);
CREATE TYPE dispute_initiator AS ENUM ('user', 'driver', 'admin');
CREATE TYPE dispute_status AS ENUM (
  'open', 'under_review', 'pending_info',
  'resolved', 'escalated', 'withdrawn'
);
CREATE TYPE dispute_outcome AS ENUM (
  'no_action', 'fare_adjusted', 'full_refund', 'partial_refund',
  'driver_warned', 'driver_suspended', 'driver_banned',
  'user_warned', 'user_suspended', 'item_recovered'
);
CREATE TYPE evidence_type AS ENUM (
  'photo', 'screenshot', 'audio', 'video', 'document'
);
CREATE TYPE evidence_upload_status AS ENUM (
  'uploading', 'available', 'deleted'
);
CREATE TYPE warning_category AS ENUM (
  'late_arrival', 'rude_behaviour', 'vehicle_condition', 'speeding',
  'route_manipulation', 'dress_code', 'phone_usage_while_driving',
  'false_trip_completion', 'other'
);
CREATE TYPE warning_severity AS ENUM ('minor', 'moderate', 'severe');

-- Config
CREATE TYPE config_value_type AS ENUM (
  'integer', 'decimal', 'boolean', 'string', 'json'
);
CREATE TYPE config_status AS ENUM ('draft', 'active', 'deprecated');

-- Notifications
CREATE TYPE notif_channel AS ENUM (
  'sms', 'push', 'voice', 'email', 'whatsapp', 'in_app'
);
CREATE TYPE notif_status AS ENUM (
  'queued', 'sent', 'delivered', 'failed', 'cancelled'
);

-- Feature flags
CREATE TYPE flag_rollout AS ENUM (
  'disabled', 'enabled_all', 'percentage', 'city_list', 'entity_list'
);

-- Jobs
CREATE TYPE job_status AS ENUM (
  'pending', 'running', 'completed', 'failed', 'skipped'
);
CREATE TYPE snapshot_granularity AS ENUM (
  'hourly', 'daily', 'weekly', 'monthly'
);

-- Wallet
CREATE TYPE driver_wallet_entry_type AS ENUM (
  'topup', 'commission_debit', 'adjustment_credit',
  'adjustment_debit', 'refund_credit'
);
CREATE TYPE user_wallet_entry_type AS ENUM (
  'cashback', 'referral_bonus', 'ride_debit',
  'adjustment_credit', 'adjustment_debit', 'refund_credit'
);
CREATE TYPE wallet_entry_status AS ENUM (
  'pending', 'completed', 'failed', 'reversed'
);

-- Messaging
CREATE TYPE message_sender_role AS ENUM (
  'user', 'driver', 'support', 'system'
);
CREATE TYPE conversation_type AS ENUM (
  'ride_chat', 'support_ticket', 'announcement'
);
CREATE TYPE conversation_status AS ENUM ('active', 'closed', 'archived');
