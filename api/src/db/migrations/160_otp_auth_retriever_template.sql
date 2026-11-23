-- 160_otp_auth_retriever_template.sql
-- Login OTP in the Android auto-read (SMS Retriever) layout: the code first, the app's 11-character hash alone on the last line
-- ({{appHash}}, from ANDROID_SMS_HASH_RIDER / ANDROID_SMS_HASH_DRIVER). This exact wording has to be registered as a new DLT template
-- (with the code and the hash as the two variables) and its id set in BULKSMSPLANS_OTP_AUTOREAD_TEMPLATE_ID; until then the server keeps
-- sending the original template 193042 wording (see lib/otp-sms.ts), so applying this migration changes nothing by itself.
-- "<#> " at the start is the marker older Google Play services versions expect; the whole message stays well under the 140 byte limit.
-- Additive and backward compatible: a new row only.
SET LOCAL lock_timeout = '10s';

INSERT INTO notification_templates (slug, name, channel, subject, body, variables_schema)
SELECT 'otp_auth_retriever', 'Login OTP (SMS, Android auto-read)', 'sms', NULL,
       E'<#> {{otp}} is your OTP for OD CAR RENTALS PRIVATE LIMITED. Do not share it with anyone. Valid for 10 minutes.\n{{appHash}}',
       '{"required": ["otp", "appHash"], "optional": []}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM notification_templates WHERE slug = 'otp_auth_retriever' AND channel = 'sms');
