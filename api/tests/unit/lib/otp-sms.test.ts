import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chooseLoginOtpSms, type OtpSmsConfig } from '@/lib/otp-sms'

// Value: protects=an app that can auto-read gets the Android layout (code first, its own app hash last), and nobody else is moved off the
// approved wording; fails_when=the wrong app's hash is used, an app that did not ask gets the new layout, or a half-configured server
// (no hash, or no template id) sends a message the phone cannot match; why_new=Android SMS auto-read; seam=pure function;
// no_claim=that a phone really reads the SMS (checked on a device).
const full: OtpSmsConfig = {
  BULKSMSPLANS_OTP_TEMPLATE_ID: '193042', BULKSMSPLANS_OTP_AUTOREAD_TEMPLATE_ID: '555001',
  ANDROID_SMS_HASH_RIDER: 'RiderHash+/1', ANDROID_SMS_HASH_DRIVER: 'DriverHash2',
}
const original = { slug: 'otp_auth', templateId: '193042', context: { otp: '123456' } }

describe('chooseLoginOtpSms', () => {
  it('an app that asks for auto-read gets the auto-read layout with the hash of ITS OWN app', () => {
    expect(chooseLoginOtpSms('123456', 'user', true, full)).toEqual({ slug: 'otp_auth_retriever', templateId: '555001', context: { otp: '123456', appHash: 'RiderHash+/1' } })
    expect(chooseLoginOtpSms('123456', 'driver', true, full)).toEqual({ slug: 'otp_auth_retriever', templateId: '555001', context: { otp: '123456', appHash: 'DriverHash2' } })
  })

  it('an app that did not ask, or an older one, keeps the original wording and template', () => {
    expect(chooseLoginOtpSms('123456', 'user', undefined, full)).toEqual(original)
    expect(chooseLoginOtpSms('123456', 'driver', false, full)).toEqual(original)
  })

  it('a half-configured server never sends a message the phone could not match: no hash, or no template id, means the original', () => {
    expect(chooseLoginOtpSms('123456', 'user', true, { ...full, ANDROID_SMS_HASH_RIDER: '' })).toEqual(original)
    expect(chooseLoginOtpSms('123456', 'driver', true, { ...full, ANDROID_SMS_HASH_DRIVER: '' })).toEqual(original)
    expect(chooseLoginOtpSms('123456', 'user', true, { ...full, BULKSMSPLANS_OTP_AUTOREAD_TEMPLATE_ID: '' })).toEqual(original)
    expect(chooseLoginOtpSms('123456', undefined, true, full)).toEqual(original)
  })

  it('the original keeps no template id when none is configured', () => {
    expect(chooseLoginOtpSms('123456', 'user', false, { ...full, BULKSMSPLANS_OTP_TEMPLATE_ID: '' }).templateId).toBeUndefined()
  })

  it('the rendered auto-read message is under the 140 byte limit and ends with the hash on its own line', () => {
    // The real wording, read from the migration that inserts it, with a full-length code and hash.
    const sql = readFileSync(join(__dirname, '../../../src/db/migrations/160_otp_auth_retriever_template.sql'), 'utf8')
    const template = /E'(<#>[^']*)'/.exec(sql)![1]!.replace('\\n', '\n')
    const body = template.replace('{{otp}}', '123456').replace('{{appHash}}', 'RiderHash+/1')
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(140)
    expect(body.split('\n').at(-1)).toBe('RiderHash+/1')
  })
})
