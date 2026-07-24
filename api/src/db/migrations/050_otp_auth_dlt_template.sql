-- DLT-approved template 193042 (BulkSMSPlans header "ODCARI") is registered
-- for exactly this wording — only {{otp}} may vary. Login OTP only; ride
-- start/end OTPs keep their own wording (they must tell the rider to share
-- the code with their driver, which this template's text does not allow).
UPDATE notification_templates
SET body = 'Dear Customer, your OTP for verification with OD CAR RENTALS PRIVATE LIMITED is {{otp}}. Do not share it with anyone. Valid for 10 minutes.',
    version = version + 1,
    updated_at = now()
WHERE slug = 'otp_auth' AND channel = 'sms' AND is_active;
