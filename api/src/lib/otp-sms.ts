// Which SMS a login OTP goes out as. Pure, so the choice is tested without a vendor or a queue.
//
// An Android app that can auto-read (asks with autoRead) gets the Retriever layout: the code on the first line and the app's 11-character
// hash on the last, which lets Google Play services hand the code to the app without a tap and without any SMS permission. Everyone else
// (older apps, other platforms, or a hash / template not configured yet) gets the original approved wording, exactly as before.

export type OtpSmsChoice = { slug: 'otp_auth' | 'otp_auth_retriever'; templateId: string | undefined; context: Record<string, string> }

export type OtpSmsConfig = {
  BULKSMSPLANS_OTP_TEMPLATE_ID: string
  BULKSMSPLANS_OTP_AUTOREAD_TEMPLATE_ID: string
  ANDROID_SMS_HASH_RIDER: string
  ANDROID_SMS_HASH_DRIVER: string
}

export function chooseLoginOtpSms(otp: string, role: 'user' | 'driver' | undefined, autoRead: boolean | undefined, cfg: OtpSmsConfig): OtpSmsChoice {
  const hash = role === 'driver' ? cfg.ANDROID_SMS_HASH_DRIVER : role === 'user' ? cfg.ANDROID_SMS_HASH_RIDER : ''
  if (autoRead === true && hash !== '' && cfg.BULKSMSPLANS_OTP_AUTOREAD_TEMPLATE_ID !== '') {
    return { slug: 'otp_auth_retriever', templateId: cfg.BULKSMSPLANS_OTP_AUTOREAD_TEMPLATE_ID, context: { otp, appHash: hash } }
  }
  return { slug: 'otp_auth', templateId: cfg.BULKSMSPLANS_OTP_TEMPLATE_ID || undefined, context: { otp } }
}
