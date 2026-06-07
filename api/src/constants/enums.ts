export const PrincipalRole = {
  USER: 'user',
  DRIVER: 'driver',
  ADMIN: 'admin',
} as const
export type PrincipalRole = (typeof PrincipalRole)[keyof typeof PrincipalRole]

export const UserStatus = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  DELETED: 'deleted',
} as const
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus]

export const DriverStatus = {
  PENDING_DOCS: 'pending_docs',
  PENDING_APPROVAL: 'pending_approval',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  BANNED: 'banned',
} as const
export type DriverStatus = (typeof DriverStatus)[keyof typeof DriverStatus]

export const AdminRole = {
  SUPER_ADMIN: 'super_admin',
  OPS_ADMIN: 'ops_admin',
  SUPPORT_ADMIN: 'support_admin',
  FINANCE_ADMIN: 'finance_admin',
} as const
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole]

export const OtpPurpose = {
  LOGIN: 'login',
  TRIP_START: 'trip_start',
  TRIP_END: 'trip_end',
  ACCOUNT_DELETION: 'account_deletion',
} as const
export type OtpPurpose = (typeof OtpPurpose)[keyof typeof OtpPurpose]

export const DocStatus = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
} as const
export type DocStatus = (typeof DocStatus)[keyof typeof DocStatus]

export const DocType = {
  DRIVING_LICENSE: 'driving_license',
  ID_PROOF: 'id_proof',
} as const
export type DocType = (typeof DocType)[keyof typeof DocType]

export const VerificationKind = {
  DAILY_SELFIE: 'daily_selfie',
  DAILY_PLATE: 'daily_plate',
} as const
export type VerificationKind = (typeof VerificationKind)[keyof typeof VerificationKind]

export const VerificationStatus = {
  PENDING: 'pending',
  PASSED: 'passed',
  FAILED: 'failed',
  AUTO_PASSED: 'auto_passed',
} as const
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus]

export const DriveMode = {
  STANDARD: 'standard',
  RETURN_CAB: 'return_cab',
} as const
export type DriveMode = (typeof DriveMode)[keyof typeof DriveMode]

export const SessionState = {
  ONLINE: 'online',
  ON_TRIP: 'on_trip',
  OFFLINE: 'offline',
} as const
export type SessionState = (typeof SessionState)[keyof typeof SessionState]

export const VehicleState = {
  PENDING: 'pending',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  BLACKLISTED: 'blacklisted',
} as const
export type VehicleState = (typeof VehicleState)[keyof typeof VehicleState]

export const DriverVehicleDocType = {
  VEHICLE_RC: 'vehicle_rc',
  INSURANCE: 'insurance',
  PERMIT: 'permit',
  POLLUTION_CERT: 'pollution_cert',
  FITNESS_CERT: 'fitness_cert',
} as const
export type DriverVehicleDocType = (typeof DriverVehicleDocType)[keyof typeof DriverVehicleDocType]

export const ZoneType = {
  CITY: 'city',
  HIGHWAY: 'highway',
  EXPRESSWAY: 'expressway',
} as const
export type ZoneType = (typeof ZoneType)[keyof typeof ZoneType]

export const CityStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  INACTIVE: 'inactive',
} as const
export type CityStatus = (typeof CityStatus)[keyof typeof CityStatus]

export const RideType = {
  ONE_WAY: 'one_way',
  ROUND_TRIP: 'round_trip',
  RENTAL: 'rental',
} as const
export type RideType = (typeof RideType)[keyof typeof RideType]

export const FareStatus = {
  ESTIMATE: 'estimate',
  FINAL: 'final',
  DISPUTED: 'disputed',
  REFUNDED: 'refunded',
} as const
export type FareStatus = (typeof FareStatus)[keyof typeof FareStatus]

export const SurgeStatus = {
  SCHEDULED: 'scheduled',
  ACTIVE: 'active',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const
export type SurgeStatus = (typeof SurgeStatus)[keyof typeof SurgeStatus]

export const RideStatus = {
  REQUESTED: 'requested',
  ACCEPTED: 'accepted',
  DRIVER_ARRIVED: 'driver_arrived',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_DRIVERS: 'no_drivers',
} as const
export type RideStatus = (typeof RideStatus)[keyof typeof RideStatus]

export const TransitionActor = {
  USER: 'user',
  DRIVER: 'driver',
  SYSTEM: 'system',
  ADMIN: 'admin',
  RIDE_COMPLETION: 'ride_completion',
  TIMEOUT: 'timeout',
} as const
export type TransitionActor = (typeof TransitionActor)[keyof typeof TransitionActor]

export const AssignmentStatus = {
  OFFERED: 'offered',
  ACCEPTED: 'accepted',
  DECLINED: 'declined',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
} as const
export type AssignmentStatus = (typeof AssignmentStatus)[keyof typeof AssignmentStatus]

export const StopStatus = {
  PENDING: 'pending',
  REACHED: 'reached',
  SKIPPED: 'skipped',
} as const
export type StopStatus = (typeof StopStatus)[keyof typeof StopStatus]

export const RideOtpType = {
  TRIP_START: 'trip_start',
  TRIP_END: 'trip_end',
} as const
export type RideOtpType = (typeof RideOtpType)[keyof typeof RideOtpType]

export const CancelActor = {
  USER: 'user',
  DRIVER: 'driver',
  ADMIN: 'admin',
  SYSTEM: 'system',
} as const
export type CancelActor = (typeof CancelActor)[keyof typeof CancelActor]

export const CancelStage = {
  BEFORE_ACCEPTANCE: 'before_acceptance',
  AFTER_ACCEPTANCE: 'after_acceptance',
  AFTER_ARRIVAL: 'after_arrival',
  IN_PROGRESS: 'in_progress',
} as const
export type CancelStage = (typeof CancelStage)[keyof typeof CancelStage]

export const AdvanceBookingStatus = {
  PENDING_DRIVER: 'pending_driver',
  DRIVER_CONFIRMED: 'driver_confirmed',
  DISPATCHED: 'dispatched',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const
export type AdvanceBookingStatus = (typeof AdvanceBookingStatus)[keyof typeof AdvanceBookingStatus]

export const PaymentChannel = {
  CASH_DIRECT: 'cash_direct',
  COMPANY_QR: 'company_qr',
  ONLINE_WALLET: 'online_wallet',
  ONLINE_UPI: 'online_upi',
  ONLINE_CARD: 'online_card',
  PLATFORM_WALLET: 'platform_wallet',
} as const
export type PaymentChannel = (typeof PaymentChannel)[keyof typeof PaymentChannel]

export const PaymentStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  DISPUTED: 'disputed',
} as const
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus]

export const GatewayEventType = {
  ORDER_CREATED: 'order_created',
  PAYMENT_AUTHORIZED: 'payment_authorized',
  PAYMENT_CAPTURED: 'payment_captured',
  PAYMENT_FAILED: 'payment_failed',
  REFUND_CREATED: 'refund_created',
  REFUND_PROCESSED: 'refund_processed',
  REFUND_FAILED: 'refund_failed',
  DISPUTE_CREATED: 'dispute_created',
  DISPUTE_RESOLVED: 'dispute_resolved',
} as const
export type GatewayEventType = (typeof GatewayEventType)[keyof typeof GatewayEventType]

export const SettlementStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  ON_HOLD: 'on_hold',
} as const
export type SettlementStatus = (typeof SettlementStatus)[keyof typeof SettlementStatus]

export const RefundStatus = {
  REQUESTED: 'requested',
  APPROVED: 'approved',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const
export type RefundStatus = (typeof RefundStatus)[keyof typeof RefundStatus]

export const LedgerEntryType = {
  RIDE_EARNING: 'ride_earning',
  SETTLEMENT_DEBIT: 'settlement_debit',
  CANCELLATION_FEE: 'cancellation_fee',
  ADJUSTMENT_CREDIT: 'adjustment_credit',
  ADJUSTMENT_DEBIT: 'adjustment_debit',
  COMMISSION_DEBIT: 'commission_debit',
} as const
export type LedgerEntryType = (typeof LedgerEntryType)[keyof typeof LedgerEntryType]

export const RatingDirection = {
  USER_TO_DRIVER: 'user_to_driver',
  DRIVER_TO_USER: 'driver_to_user',
} as const
export type RatingDirection = (typeof RatingDirection)[keyof typeof RatingDirection]

export const TagSentiment = {
  POSITIVE: 'positive',
  NEGATIVE: 'negative',
  NEUTRAL: 'neutral',
} as const
export type TagSentiment = (typeof TagSentiment)[keyof typeof TagSentiment]

export const TagAppliesTo = {
  DRIVER: 'driver',
  USER: 'user',
  BOTH: 'both',
} as const
export type TagAppliesTo = (typeof TagAppliesTo)[keyof typeof TagAppliesTo]

export const SosSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
} as const
export type SosSeverity = (typeof SosSeverity)[keyof typeof SosSeverity]

export const SosStatus = {
  TRIGGERED: 'triggered',
  ACKNOWLEDGED: 'acknowledged',
  RESPONDING: 'responding',
  RESOLVED: 'resolved',
  FALSE_ALARM: 'false_alarm',
} as const
export type SosStatus = (typeof SosStatus)[keyof typeof SosStatus]

export const NotificationChannel = {
  SMS: 'sms',
  CALL: 'call',
  PUSH: 'push',
  WHATSAPP: 'whatsapp',
} as const
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel]

export const NotificationDelivery = {
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  NO_RESPONSE: 'no_response',
} as const
export type NotificationDelivery = (typeof NotificationDelivery)[keyof typeof NotificationDelivery]

export const DisputeType = {
  FARE_OVERCHARGE: 'fare_overcharge',
  DRIVER_BEHAVIOUR: 'driver_behaviour',
  VEHICLE_CONDITION: 'vehicle_condition',
  LOST_ITEM: 'lost_item',
  TRIP_MANIPULATION: 'trip_manipulation',
  PAYMENT_ISSUE: 'payment_issue',
  SAFETY_INCIDENT: 'safety_incident',
  OTHER: 'other',
} as const
export type DisputeType = (typeof DisputeType)[keyof typeof DisputeType]

export const DisputeInitiator = {
  USER: 'user',
  DRIVER: 'driver',
  ADMIN: 'admin',
} as const
export type DisputeInitiator = (typeof DisputeInitiator)[keyof typeof DisputeInitiator]

export const DisputeStatus = {
  OPEN: 'open',
  UNDER_REVIEW: 'under_review',
  PENDING_INFO: 'pending_info',
  RESOLVED: 'resolved',
  ESCALATED: 'escalated',
  WITHDRAWN: 'withdrawn',
} as const
export type DisputeStatus = (typeof DisputeStatus)[keyof typeof DisputeStatus]

export const DisputeOutcome = {
  NO_ACTION: 'no_action',
  FARE_ADJUSTED: 'fare_adjusted',
  FULL_REFUND: 'full_refund',
  PARTIAL_REFUND: 'partial_refund',
  DRIVER_WARNED: 'driver_warned',
  DRIVER_SUSPENDED: 'driver_suspended',
  DRIVER_BANNED: 'driver_banned',
  USER_WARNED: 'user_warned',
  USER_SUSPENDED: 'user_suspended',
  ITEM_RECOVERED: 'item_recovered',
} as const
export type DisputeOutcome = (typeof DisputeOutcome)[keyof typeof DisputeOutcome]

export const EvidenceType = {
  PHOTO: 'photo',
  SCREENSHOT: 'screenshot',
  AUDIO: 'audio',
  VIDEO: 'video',
  DOCUMENT: 'document',
} as const
export type EvidenceType = (typeof EvidenceType)[keyof typeof EvidenceType]

export const EvidenceUploadStatus = {
  UPLOADING: 'uploading',
  AVAILABLE: 'available',
  DELETED: 'deleted',
} as const
export type EvidenceUploadStatus = (typeof EvidenceUploadStatus)[keyof typeof EvidenceUploadStatus]

export const WarningCategory = {
  LATE_ARRIVAL: 'late_arrival',
  RUDE_BEHAVIOUR: 'rude_behaviour',
  VEHICLE_CONDITION: 'vehicle_condition',
  SPEEDING: 'speeding',
  ROUTE_MANIPULATION: 'route_manipulation',
  DRESS_CODE: 'dress_code',
  PHONE_USAGE_WHILE_DRIVING: 'phone_usage_while_driving',
  FALSE_TRIP_COMPLETION: 'false_trip_completion',
  OTHER: 'other',
} as const
export type WarningCategory = (typeof WarningCategory)[keyof typeof WarningCategory]

export const WarningSeverity = {
  MINOR: 'minor',
  MODERATE: 'moderate',
  SEVERE: 'severe',
} as const
export type WarningSeverity = (typeof WarningSeverity)[keyof typeof WarningSeverity]

export const ConfigValueType = {
  INTEGER: 'integer',
  DECIMAL: 'decimal',
  BOOLEAN: 'boolean',
  STRING: 'string',
  JSON: 'json',
} as const
export type ConfigValueType = (typeof ConfigValueType)[keyof typeof ConfigValueType]

export const ConfigStatus = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  DEPRECATED: 'deprecated',
} as const
export type ConfigStatus = (typeof ConfigStatus)[keyof typeof ConfigStatus]

export const NotifChannel = {
  SMS: 'sms',
  PUSH: 'push',
  VOICE: 'voice',
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  IN_APP: 'in_app',
} as const
export type NotifChannel = (typeof NotifChannel)[keyof typeof NotifChannel]

export const NotifStatus = {
  QUEUED: 'queued',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const
export type NotifStatus = (typeof NotifStatus)[keyof typeof NotifStatus]

export const FlagRollout = {
  DISABLED: 'disabled',
  ENABLED_ALL: 'enabled_all',
  PERCENTAGE: 'percentage',
  CITY_LIST: 'city_list',
  ENTITY_LIST: 'entity_list',
} as const
export type FlagRollout = (typeof FlagRollout)[keyof typeof FlagRollout]

export const JobStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus]

export const SnapshotGranularity = {
  HOURLY: 'hourly',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
} as const
export type SnapshotGranularity = (typeof SnapshotGranularity)[keyof typeof SnapshotGranularity]

export const DriverWalletEntryType = {
  TOPUP: 'topup',
  COMMISSION_DEBIT: 'commission_debit',
  ADJUSTMENT_CREDIT: 'adjustment_credit',
  ADJUSTMENT_DEBIT: 'adjustment_debit',
  REFUND_CREDIT: 'refund_credit',
} as const
export type DriverWalletEntryType = (typeof DriverWalletEntryType)[keyof typeof DriverWalletEntryType]

export const UserWalletEntryType = {
  CASHBACK: 'cashback',
  REFERRAL_BONUS: 'referral_bonus',
  RIDE_DEBIT: 'ride_debit',
  ADJUSTMENT_CREDIT: 'adjustment_credit',
  ADJUSTMENT_DEBIT: 'adjustment_debit',
  REFUND_CREDIT: 'refund_credit',
} as const
export type UserWalletEntryType = (typeof UserWalletEntryType)[keyof typeof UserWalletEntryType]

export const WalletEntryStatus = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  REVERSED: 'reversed',
} as const
export type WalletEntryStatus = (typeof WalletEntryStatus)[keyof typeof WalletEntryStatus]

export const MessageSenderRole = {
  USER: 'user',
  DRIVER: 'driver',
  SUPPORT: 'support',
  SYSTEM: 'system',
} as const
export type MessageSenderRole = (typeof MessageSenderRole)[keyof typeof MessageSenderRole]

export const ConversationType = {
  RIDE_CHAT: 'ride_chat',
  SUPPORT_TICKET: 'support_ticket',
  ANNOUNCEMENT: 'announcement',
} as const
export type ConversationType = (typeof ConversationType)[keyof typeof ConversationType]

export const ConversationStatus = {
  ACTIVE: 'active',
  CLOSED: 'closed',
  ARCHIVED: 'archived',
} as const
export type ConversationStatus = (typeof ConversationStatus)[keyof typeof ConversationStatus]
