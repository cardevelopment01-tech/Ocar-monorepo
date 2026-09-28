import { describe, it, expect } from 'vitest'
import { csvCell, toCsv } from '@/modules/analytics/csv'
import { buildDigestMessage, yesterdayIst } from '@/modules/analytics/admin-digest'

describe('CSV formula neutralisation (CEO E6)', () => {
  it.each(['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd'])(
    'prefixes a quote on %j',
    (cell) => {
      const out = csvCell(cell)
      expect(out.replace(/^"/, '').startsWith("'")).toBe(true)
    }
  )

  it('never prefixes real numbers, including negatives', () => {
    expect(csvCell(-42.5)).toBe('-42.5')
    expect(csvCell(0)).toBe('0')
  })

  it('quotes cells with commas, quotes and newlines, and leaves plain text alone', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('Bhubaneswar')).toBe('Bhubaneswar')
    expect(csvCell(null)).toBe('')
  })

  it('writes a UTF-8 BOM, CRLF lines and a neutralised driver name', () => {
    const csv = toCsv(['Driver', 'Trips'], [['=HYPERLINK("http://x","y")', 3]])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('\r\n')
    expect(csv).toContain(`"'=HYPERLINK(""http://x"",""y"")",3`)
  })
})

describe('admin digest content (CEO E2/D6)', () => {
  const t = { gross_bookings: 12500, commission: 1875, completed_rides: 9, active_drivers: 4, cohort_completed: 9, cohort_cancelled: 3 }

  it('finance class gets five KPIs including money', () => {
    const m = buildDigestMessage('2026-09-28', t, 'finance')
    expect(m.body).toContain('9 rides completed')
    expect(m.body).toContain('75% completion')
    expect(m.body).toContain('25% cancelled')
    expect(m.body).toContain('₹12,500 gross bookings')
    expect(m.body).toContain('₹1,875 Ocar revenue')
  })

  it('ops class gets the three non-money KPIs only', () => {
    const m = buildDigestMessage('2026-09-28', t, 'ops')
    expect(m.body).toContain('9 rides completed')
    expect(m.body).not.toMatch(/₹|gross|revenue/i)
  })

  it('handles an empty day and a cancellations-only day', () => {
    const empty = { ...t, gross_bookings: 0, commission: 0, completed_rides: 0, cohort_completed: 0, cohort_cancelled: 0 }
    expect(buildDigestMessage('2026-09-28', empty, 'finance').body).toBe('No completed rides yesterday.')
    const cancelOnly = { ...empty, cohort_cancelled: 4 }
    expect(buildDigestMessage('2026-09-28', cancelOnly, 'ops').body).toContain('0 completed, 4 cancelled')
  })

  it('yesterday is the previous IST calendar day, across the UTC/IST midnight gap', () => {
    // 20:00 UTC 28 Sep = 01:30 IST 29 Sep -> yesterday (IST) is 28 Sep
    expect(yesterdayIst(new Date('2026-09-28T20:00:00Z'))).toBe('2026-09-28')
    // 10:00 UTC 29 Sep = 15:30 IST 29 Sep -> 28 Sep
    expect(yesterdayIst(new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-28')
  })
})
