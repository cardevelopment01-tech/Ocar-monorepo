import { signAccessToken } from './src/lib/jwt'
import { pool } from './src/db/client'

const BASE = 'http://localhost:4000/api/v1'
// minimal valid 1x1 JPEG
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')
const d = signAccessToken({ sub: '4', role: 'driver' } as any)
const a = signAccessToken({ sub: '1', role: 'admin' } as any)
const H = (t: string) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' })
const ok = (c: boolean, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const q = async (s: string) => (await pool.query(s)).rows

async function upload(label: string) {
  const init = await fetch(`${BASE}/drivers/onboarding/documents/upload-init`, { method: 'POST', headers: H(d), body: JSON.stringify({ doc_type: 'profile_photo', content_type: 'image/jpeg', content_length: JPEG.length }) })
  const ij: any = await init.json(); ok(init.status === 200 && !!ij.upload_url, `${label}: upload-init ${init.status}`)
  const put = await fetch(ij.upload_url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: JPEG })
  ok(put.status === 200, `${label}: S3 PUT ${put.status}`)
  const done = await fetch(`${BASE}/drivers/onboarding/documents/upload-complete`, { method: 'POST', headers: H(d), body: JSON.stringify({ key: ij.key, doc_type: 'profile_photo' }) })
  const dj: any = await done.json(); ok(done.status === 200 && dj.status === 'pending', `${label}: upload-complete ${done.status} status=${dj.status}`)
}
const driverStatus = async () => (await q('select status from drivers where id=4'))[0].status
const docRow = async () => (await q("select id, status, rejection_note, rejection_count, updated_at from driver_documents where driver_id=4 and doc_type='profile_photo'"))[0]

async function main() {
  ok((await driverStatus()) === 'active', 'start: driver 4 active')
  await upload('first upload')
  let row = await docRow()
  ok(row.status === 'pending', 'doc pending after first upload')
  ok((await q('select reference_selfie_url from drivers where id=4'))[0].reference_selfie_url != null, 'reference_selfie_url set')

  const note = 'Please remove your cap, sunglasses or mask and retake the photo so riders can recognise you.'
  let r = await fetch(`${BASE}/admin/drivers/documents/${row.id}/reject`, { method: 'PATCH', headers: H(a), body: JSON.stringify({ rejection_note: note, seen_updated_at: new Date(row.updated_at).toISOString() }) })
  ok(r.status === 200, `admin reject (preset text) ${r.status} ${r.status !== 200 ? await r.text() : ''}`)
  ok((await driverStatus()) === 'docs_rejected', 'driver -> docs_rejected')

  const st: any = await (await fetch(`${BASE}/drivers/onboarding/documents/status`, { headers: H(d) })).json()
  const p = st.photos.profile_photo
  ok(p.status === 'rejected' && p.rejection_note === note && p.rejection_count === 1 && !!p.url, `driver sees rejected photo with note + url (count ${p.rejection_count})`)

  await upload('re-upload as docs_rejected')
  row = await docRow()
  ok(row.status === 'pending', 'doc back to pending after re-upload')
  ok((await driverStatus()) === 'docs_rejected', 'driver still docs_rejected until admin approves')

  r = await fetch(`${BASE}/admin/drivers/documents/${row.id}/approve`, { method: 'PATCH', headers: H(a), body: JSON.stringify({ verified_valid_until: '', seen_updated_at: new Date(row.updated_at).toISOString() }) })
  ok(r.status === 200, `admin approve ${r.status} ${r.status !== 200 ? await r.text() : ''}`)
  ok((await driverStatus()) === 'active', 'driver -> active after approval')
  const st2: any = await (await fetch(`${BASE}/drivers/onboarding/documents/status`, { headers: H(d) })).json()
  ok(st2.photos.profile_photo.status === 'approved', 'photo approved')
  await pool.end()
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
