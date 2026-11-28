import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// The onboarding reminder sweep against a REAL Postgres with every migration applied (set TEST_DATABASE_URL; skipped otherwise).
// Settings are stubbed with a map and notifications are recorded, so the test exercises the SQL, the claim guard and the choice of reminder.
const url = process.env['TEST_DATABASE_URL']

const cfg = vi.hoisted(() => ({ values: {} as Record<string, string> }))
const notify = vi.hoisted(() => ({ notifyOwner: vi.fn(async () => ({ id: '4242' })) }))
vi.mock('@/lib/system-config', () => ({ getConfigValue: async (k: string, fb: string) => cfg.values[k] ?? fb }))
vi.mock('@/modules/notifications/notifications.service', () => notify)
vi.mock('@/modules/notifications/templates.service', () => ({
  renderTemplate: vi.fn(async (slug: string, _c: string, ctx: Record<string, string>) => ({ subject: `${slug}|${ctx['headline'] ?? ''}|${ctx['pauseDate'] ?? ''}`, body: `${ctx['nextAction'] ?? ''}` })),
}))

// 11:30 India time: inside the 10:00 to 21:00 window.
const NOW = new Date('2026-12-10T06:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

describe.skipIf(!url)('onboarding reminders on a real database', () => {
  let pool: typeof import('@/db/client').pool
  let svc: typeof import('@/modules/drivers/kyc-reminders.service')
  const phones: string[] = []

  async function driver(phone: string, over: { status?: string; step?: string; updatedAgoDays: number }): Promise<string> {
    phones.push(phone)
    const r = await pool.query<{ id: string }>(
      `INSERT INTO drivers (phone, status, onboarding_step, updated_at) VALUES ($1, $2, $3, $4::timestamptz) RETURNING id::text`,
      [phone, over.status ?? 'pending_docs', over.step ?? 'documents', daysAgo(over.updatedAgoDays)])
    return r.rows[0]!.id
  }
  const sends = async (id: string) => (await pool.query<{ n: number }>('SELECT n FROM driver_kyc_reminder_sends WHERE driver_id = $1 ORDER BY n', [id])).rows.map((r) => r.n)

  beforeAll(async () => {
    ;({ pool } = await import('@/db/client'))
    svc = await import('@/modules/drivers/kyc-reminders.service')
  })
  beforeEach(async () => {
    await pool.query('DELETE FROM drivers WHERE phone = ANY($1)', [phones.splice(0)])
    cfg.values = { kyc_reminders_enabled: 'true' }
    notify.notifyOwner.mockClear()
  })
  afterAll(async () => {
    await pool.query('DELETE FROM drivers WHERE phone = ANY($1)', [phones.splice(0)])
    await pool.end()
  })

  it('sends one reminder to a driver stalled for a day, then nothing on a second sweep', async () => {
    const id = await driver('+919999001101', { updatedAgoDays: 1.2 })
    expect(await svc.sendKycReminders(NOW)).toBe(1)
    expect(await svc.sendKycReminders(NOW)).toBe(0)
    expect(await sends(id)).toEqual([1])
    const call = notify.notifyOwner.mock.calls[0]![0] as { type: string; title: string }
    expect(call.type).toBe('kyc_reminder')
    expect(call.title.startsWith("kyc_reminder_1|You're halfway there|")).toBe(true) // two steps done, first reminder
  })
  it('uses the not-started wording for a driver who finished no step', async () => {
    await driver('+919999001102', { step: 'personal_info', updatedAgoDays: 1.2 })
    await svc.sendKycReminders(NOW)
    expect((notify.notifyOwner.mock.calls[0]![0] as { title: string }).title.startsWith('kyc_reminder_1_new')).toBe(true)
  })
  it('sends the last notice with the real pause date once two reminders went out since the last progress', async () => {
    const id = await driver('+919999001103', { updatedAgoDays: 8.5 })
    await pool.query('INSERT INTO driver_kyc_reminder_sends (driver_id, n, step, sent_at) VALUES ($1,1,$2,$3), ($1,2,$2,$4)', [id, 'documents', daysAgo(7), daysAgo(4)])
    expect(await svc.sendKycReminders(NOW)).toBe(1)
    expect(await sends(id)).toEqual([1, 2, 3])
    // progress 8.5 days ago + a 10-day pause day = 11 Dec in India time
    expect((notify.notifyOwner.mock.calls[0]![0] as { title: string }).title).toContain('kyc_reminder_3|')
    expect((notify.notifyOwner.mock.calls[0]![0] as { title: string }).title).toContain('11 Dec')
  })
  it('restarts the sequence when the driver moved forward after the earlier reminders', async () => {
    const id = await driver('+919999001108', { updatedAgoDays: 1.2 })
    await pool.query('INSERT INTO driver_kyc_reminder_sends (driver_id, n, step, sent_at) VALUES ($1,1,$2,$3), ($1,2,$2,$4)', [id, 'vehicle_info', daysAgo(9), daysAgo(6)])
    expect(await svc.sendKycReminders(NOW)).toBe(1)
    expect(await sends(id)).toEqual([1, 1, 2]) // the two old sends plus a fresh first reminder, ordered by n
  })
  it('does nothing when switched off, outside the send window, or for drivers not in onboarding', async () => {
    await driver('+919999001104', { updatedAgoDays: 2 })
    await driver('+919999001105', { status: 'pending_approval', updatedAgoDays: 2 })
    await driver('+919999001106', { step: 'something_new', updatedAgoDays: 2 })
    cfg.values = { kyc_reminders_enabled: 'false' }
    expect(await svc.sendKycReminders(NOW)).toBe(0)
    cfg.values = { kyc_reminders_enabled: 'true' }
    expect(await svc.sendKycReminders(new Date('2026-12-10T20:00:00Z'))).toBe(0) // 01:30 India time
    expect(await svc.sendKycReminders(NOW)).toBe(1) // only the stalled pending_docs driver with a known step
  })
  it('the report shows each stalled driver with the result of the last send and who came back', async () => {
    const report = await import('@/modules/drivers/kyc-reminders.report')
    const reached = await driver('+919999001201', { updatedAgoDays: 3 })
    const noDevice = await driver('+919999001202', { updatedAgoDays: 3 })
    const back = await driver('+919999001203', { updatedAgoDays: 0.5 })
    for (const [id, response, sent] of [[reached, '{"successCount":1,"failureCount":0,"invalidTokens":0}', daysAgo(2)], [noDevice, null, daysAgo(2)], [back, '{"successCount":1,"failureCount":0,"invalidTokens":0}', daysAgo(2)]] as const) {
      const n = await pool.query<{ id: string }>(
        `INSERT INTO notification_logs (owner_type, owner_id, channel, status, type, title, body, sent_at, provider_response) VALUES ('driver', $1, 'in_app', 'sent', 'kyc_reminder', 't', 'b', now(), $2::jsonb) RETURNING id::text`, [id, response])
      await pool.query('INSERT INTO driver_kyc_reminder_sends (driver_id, n, step, notification_id, sent_at) VALUES ($1, 1, $2, $3::bigint, $4)', [id, 'documents', n.rows[0]!.id, sent])
    }
    const out = await report.listKycReminderReport({}, NOW)
    const byId = new Map(out.rows.map((r) => [r.driverId, r]))
    expect(byId.get(reached)).toMatchObject({ state: 'reminded', lastResult: 'reached' })
    expect(byId.get(noDevice)).toMatchObject({ state: 'reminded', lastResult: 'no_device' })
    expect(byId.get(back)).toMatchObject({ state: 'came_back' })
    expect((await report.listKycReminderReport({ result: 'no_device' }, NOW)).rows.map((r) => r.driverId)).toContain(noDevice)
    await pool.query('DELETE FROM notification_logs WHERE owner_type = $1 AND owner_id = ANY($2::bigint[])', ['driver', [reached, noDevice, back]])
  })
  it('attaches the step picture only when a picture folder is configured', async () => {
    await driver('+919999001301', { updatedAgoDays: 1.2 }) // two steps done: documents
    await svc.sendKycReminders(NOW)
    expect((notify.notifyOwner.mock.calls[0]![0] as { imageUrl?: string }).imageUrl).toBeUndefined()
    await pool.query('DELETE FROM driver_kyc_reminder_sends WHERE driver_id IN (SELECT id FROM drivers WHERE phone = $1)', ['+919999001301'])
    notify.notifyOwner.mockClear()
    cfg.values = { kyc_reminders_enabled: 'true', kyc_banner_base_url: 'https://ocarindia.example/push' }
    await svc.sendKycReminders(NOW)
    expect((notify.notifyOwner.mock.calls[0]![0] as { imageUrl?: string }).imageUrl).toBe('https://ocarindia.example/push/kyc-step-2.png')
  })
  describe('catch-up for drivers who were already past the pause day', () => {
    const plusDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000)
    it('does nothing for them while the switch is off', async () => {
      await driver('+919999001401', { updatedAgoDays: 40 })
      expect(await svc.sendKycReminders(NOW)).toBe(0)
    })
    it('runs the same three reminders from the first one: now, 3 days later, 7 days later, then pauses; the pause date counts from the first', async () => {
      cfg.values = { kyc_reminders_enabled: 'true', kyc_catchup_enabled: 'true' }
      const id = await driver('+919999001402', { updatedAgoDays: 40 })
      expect(await svc.sendKycReminders(NOW)).toBe(1)
      expect((notify.notifyOwner.mock.calls[0]![0] as { title: string }).title).toContain('kyc_reminder_1|')
      expect((notify.notifyOwner.mock.calls[0]![0] as { title: string }).title).toContain('19 Dec') // first reminder + 10 - 1 days
      expect(await svc.sendKycReminders(NOW)).toBe(0)
      expect(await svc.sendKycReminders(plusDays(2))).toBe(0)
      expect(await svc.sendKycReminders(plusDays(3))).toBe(1)
      expect(await svc.sendKycReminders(plusDays(7))).toBe(1)
      expect(await sends(id)).toEqual([1, 2, 3])
      expect(await svc.sendKycReminders(plusDays(9))).toBe(0) // paused again
    })
    it('leaves alone a driver who already had the normal reminders, even with the switch on', async () => {
      cfg.values = { kyc_reminders_enabled: 'true', kyc_catchup_enabled: 'true' }
      const id = await driver('+919999001403', { updatedAgoDays: 40 })
      await pool.query('INSERT INTO driver_kyc_reminder_sends (driver_id, n, step, sent_at) VALUES ($1,1,$2,$3), ($1,2,$2,$4), ($1,3,$2,$5)', [id, 'documents', daysAgo(39), daysAgo(36), daysAgo(32)])
      expect(await svc.sendKycReminders(NOW)).toBe(0)
    })
    it('a newer driver in the normal window still gets theirs, and the report shows a catch-up driver as reminded, not paused', async () => {
      cfg.values = { kyc_reminders_enabled: 'true', kyc_catchup_enabled: 'true' }
      await driver('+919999001404', { updatedAgoDays: 1.2 })
      const old = await driver('+919999001405', { updatedAgoDays: 60 })
      expect(await svc.sendKycReminders(NOW)).toBe(2)
      const report = await import('@/modules/drivers/kyc-reminders.report')
      const row = (await report.listKycReminderReport({}, NOW)).rows.find((r) => r.driverId === old)
      expect(row?.state).toBe('reminded')
    })
  })
  it('stops once the application is paused', async () => {
    await driver('+919999001107', { updatedAgoDays: 11 })
    expect(await svc.sendKycReminders(NOW)).toBe(0)
  })
})
