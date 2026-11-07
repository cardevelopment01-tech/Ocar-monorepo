import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DLT_VARIABLE_MAX, dltVariable, shareTokenFromUrl } from '@/modules/ride-shares/share-sms'

// Value: protects=the two trip-share SMS wordings staying exactly what DLT approved (and a name that fits its slot);
// fails_when=someone edits the wording in the migration or the document alone, so the vendor rejects the text as unregistered;
// why_new=new DLT wordings; seam=none (reads the migration and the document); no_claim=that the vendor accepted the template.
const TRIP_SHARE = 'Ocar: {#var1#} is sharing a live ride with you. Track it here: https://ocarindia.com/t/{#var2#}'
const SOS_LIVE = 'Ocar SAFETY ALERT: {#var1#} pressed the SOS button during an Ocar ride and may need help. Live location: https://ocarindia.com/t/{#var2#} Please call them now.'

const repo = (p: string) => readFileSync(resolve(__dirname, '../../../../', p), 'utf8')
const bodyOf = (sql: string, slug: string): string => {
  // The body is the first quoted string on the line after "('<slug>', ..."; a doubled '' inside it is one apostrophe.
  const at = sql.indexOf(`('${slug}',`)
  if (at < 0) throw new Error(`template ${slug} not found in the migration`)
  const start = sql.indexOf("'", sql.indexOf(String.fromCharCode(10), at)) + 1
  let end = start
  while (!(sql[end] === "'" && sql[end + 1] !== "'")) end += sql[end] === "'" ? 2 : 1
  return sql.slice(start, end).replace(/''/g, "'")
}
const asDlt = (body: string) => { let n = 0; return body.replace(/\{\{\w+\}\}/g, () => `{#var${++n}#}`) } // slots in order: 1 = name, 2 = token

describe('trip-share SMS wordings', () => {
  const sql = repo('api/src/db/migrations/126_ride_shares.sql')
  const doc = repo('docs/DLT_TEMPLATES_TRIP_SHARE.md')

  it('the migration says exactly what is registered, with the {{slots}} as {#var1#}, {#var2#}', () => {
    expect(asDlt(bodyOf(sql, 'trip_share'))).toBe(TRIP_SHARE)
    expect(asDlt(bodyOf(sql, 'sos_contact_live'))).toBe(SOS_LIVE)
  })

  it('the document to paste into the DLT form says the same', () => {
    expect(doc).toContain(TRIP_SHARE)
    expect(doc).toContain(SOS_LIVE)
  })

  it('a name fits one DLT slot, trimmed, and the token comes off the end of a share URL', () => {
    expect(dltVariable('Asha')).toBe('Asha')
    expect(dltVariable('A'.repeat(80))).toHaveLength(DLT_VARIABLE_MAX)
    expect(dltVariable(`${'B'.repeat(29)} Extra`)).toBe('B'.repeat(29)) // no dangling space at the cut
    expect(shareTokenFromUrl('https://ocarindia.com/t/abcdefghijklmnopqrstuv')).toBe('abcdefghijklmnopqrstuv')
  })
})
