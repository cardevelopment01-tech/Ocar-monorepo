import PDFDocument from 'pdfkit'
import path from 'node:path'
import { money, type ReceiptModel } from './receipt.model'

// Draws the receipt (see receipt.model.ts) as an A4 PDF with pdfkit: pure JS, no browser. Content flows down the page and breaks
// between blocks (never inside a stop, a fare row or a card); the legal footer and "Page x of y" print on every page.

const ASSETS = path.resolve(__dirname, '../../../../assets')
const FONT = {
  reg: path.join(ASSETS, 'fonts/PlusJakartaSans_400Regular.ttf'),
  sb: path.join(ASSETS, 'fonts/PlusJakartaSans_600SemiBold.ttf'),
  b: path.join(ASSETS, 'fonts/PlusJakartaSans_700Bold.ttf'),
  xb: path.join(ASSETS, 'fonts/PlusJakartaSans_800ExtraBold.ttf'),
  odia: path.join(ASSETS, 'fonts/NotoSansOriya.ttf'),
}
const LOGO = path.join(ASSETS, 'logo-mark.png')

const C = {
  ink: '#14171A', muted: '#5F6468', label: '#6B7176', faint: '#8A9094', line: '#E4E7E9', hair: '#EEF0F1',
  teal: '#0E8FA3', tealText: '#0A7788', tealWash: '#E8F4F6', tealLine: '#D3EAEE', mapBg: '#EEF6F6',
  green: '#17803D', greenWash: '#E7F5EC', amber: '#8A5A00', amberWash: '#FFF3D6', gold: '#D6A552', plate: '#FFD21F', plateBlue: '#1D3F8F',
}

const PW = 595.28, PH = 841.89, MX = 42, TOP = 40, BOTTOM = 62
const CW = PW - MX * 2
const ODIA = /[଀-୿]/

type Font = keyof typeof FONT
export function renderReceiptPdf(m: ReceiptModel): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 }, bufferPages: true, info: { Title: `Ocar trip receipt ${m.tripNo}`, Author: 'Ocar' } })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    for (const [k, p] of Object.entries(FONT)) doc.registerFont(k, p)

    let y = TOP
    const limit = () => PH - BOTTOM
    const ensure = (h: number) => { if (y + h > limit()) { doc.addPage(); y = TOP; return true } return false }

    // Text with the right font: Odia script falls back to Noto Sans Oriya for the whole string.
    const t = (s: string, x: number, yy: number, o: { f?: Font; size?: number; color?: string; width?: number; align?: 'left' | 'right' | 'center'; spacing?: number } = {}) => {
      const f = ODIA.test(s) ? 'odia' : o.f ?? 'reg'
      doc.font(f).fontSize(o.size ?? 10).fillColor(o.color ?? C.ink)
      doc.text(s, x, yy, { width: o.width ?? CW, align: o.align ?? 'left', lineBreak: o.width != null, characterSpacing: o.spacing ?? 0 })
    }
    const h = (s: string, size: number, width: number, f: Font = 'reg') => { doc.font(ODIA.test(s) ? 'odia' : f).fontSize(size); return doc.heightOfString(s, { width }) }
    const w = (s: string, size: number, f: Font = 'reg') => { doc.font(ODIA.test(s) ? 'odia' : f).fontSize(size); return doc.widthOfString(s) }
    const caps = (s: string, x: number, yy: number) => t(s.toUpperCase(), x, yy, { f: 'b', size: 7.5, color: C.label, spacing: 1 })

    // ── Masthead
    doc.image(LOGO, MX, y, { height: 30 })
    t(m.kind === 'cancelled' ? 'CANCELLATION RECEIPT' : 'TRIP RECEIPT', MX, y, { f: 'b', size: 7.5, spacing: 1, width: CW, align: 'right' })
    t(`No. ${m.tripNo}`, MX, y + 11, { size: 9, color: C.muted, width: CW, align: 'right' })
    t(m.dateLabel, MX, y + 22, { size: 9, color: C.muted, width: CW, align: 'right' })
    y += 46
    t(m.kind === 'cancelled' ? 'Your trip was cancelled' : `Thanks for riding${m.firstName ? `, ${m.firstName}` : ''}`, MX, y, { f: 'xb', size: 21 })
    y += 34

    // ── Hero total
    const heroH = 70
    doc.roundedRect(MX, y, CW, heroH, 12).fillAndStroke(C.tealWash, C.tealLine)
    caps(m.heroLabel, MX + 18, y + 12)
    t('₹', MX + 18, y + 31, { f: 'b', size: 18, color: C.muted })
    t(money(m.total).slice(1), MX + 18 + w('₹', 18, 'b') + 2, y + 23, { f: 'xb', size: 31 })
    const pillText = m.status.text
    const pw = w(pillText, 9, 'b') + 22
    const pillX = MX + CW - 18 - pw
    const pillFill = m.status.tone === 'good' ? C.greenWash : m.status.tone === 'due' ? C.amberWash : C.hair
    const pillInk = m.status.tone === 'good' ? C.green : m.status.tone === 'due' ? C.amber : C.muted
    doc.roundedRect(pillX, y + 12, pw, 18, 9).fill(pillFill)
    if (m.status.tone === 'good') {
      doc.circle(pillX + 11, y + 21, 4.2).fill(pillInk)
      doc.lineWidth(1.2).lineCap('round').lineJoin('round').moveTo(pillX + 9, y + 21).lineTo(pillX + 10.4, y + 22.4).lineTo(pillX + 13, y + 19.6).stroke('#FFFFFF')
    }
    t(pillText, pillX + (m.status.tone === 'good' ? 18 : 11), y + 17, { f: 'b', size: 9, color: pillInk, width: pw })
    t(m.method, MX, y + 38, { f: 'sb', size: 9.5, width: CW - 18, align: 'right' })
    if (m.paidLabel) t(m.paidLabel, MX, y + 51, { size: 8.5, color: C.muted, width: CW - 18, align: 'right' })
    y += heroH + 8

    const strip = (text: string, fill: string, ink: string) => {
      const hh = h(text, 9, CW - 28, 'sb') + 14
      ensure(hh + 8)
      doc.roundedRect(MX, y, CW, hh, 9).fill(fill)
      t(text, MX + 14, y + 7, { f: 'sb', size: 9, color: ink, width: CW - 28 })
      y += hh + 8
    }
    if (m.note) strip(m.note, C.amberWash, C.amber)
    if (m.saved > 0) strip(`You saved ${money(m.saved)} on this trip`, C.greenWash, C.green)

    // ── Trip: route diagram floats right on the first page, stops flow beside it and then below
    y += 8
    ensure(60)
    caps('Trip', MX, y)
    y += 14
    const mapW = 214, mapH = 168, gap = 18
    const mapTop = y
    let mapBottom = 0
    if (m.kind === 'trip' && (m.trail.length >= 2 || m.pins.length >= 2)) {
      drawRoute(doc, m, MX + CW - mapW, mapTop, mapW, mapH)
      mapBottom = mapTop + mapH + 10
    }
    m.timeline.forEach((s, i) => {
      const narrow = y < mapBottom
      const tw = (narrow ? CW - mapW - gap : CW) - 22
      const addrH = s.address ? h(s.address, 9, tw) : 0
      const blockH = 13 + addrH + (s.note ? 17 : 0) + 11
      const broke = ensure(blockH)
      if (broke) mapBottom = 0
      const x = MX + 20
      const isLast = i === m.timeline.length - 1
      if (!isLast) doc.lineWidth(1.5).strokeColor(C.line).moveTo(MX + 4, y + 13).lineTo(MX + 4, y + blockH + 2).stroke()
      if (s.kind === 'start') doc.circle(MX + 4, y + 5, 4.2).lineWidth(2.2).fillAndStroke('#FFFFFF', C.teal)
      else if (s.kind === 'end') doc.roundedRect(MX, y + 1, 8, 8, 2).lineWidth(2.2).fillAndStroke('#FFFFFF', C.ink)
      else doc.circle(MX + 4, y + 5, 2.6).lineWidth(1.5).fillAndStroke('#FFFFFF', C.faint)
      const head = s.time ? s.time : ''
      if (head) t(head, x, y, { f: 'b', size: 9, width: tw })
      t(s.label, x + (head ? w(head, 9, 'b') + 6 : 0), y + 0.5, { f: 'sb', size: 8.5, color: C.faint, width: tw })
      let yy = y + 13
      if (s.address) { t(s.address, x, yy, { size: 9, color: C.muted, width: tw }); yy += addrH + 3 }
      if (s.note) {
        const nw = w(s.note, 8, 'sb') + 14
        doc.roundedRect(x, yy, nw, 13, 4).fill(C.amberWash)
        t(s.note, x + 7, yy + 3, { f: 'sb', size: 8, color: C.amber, width: nw })
      }
      y += blockH
    })
    if (mapBottom > y) y = mapBottom

    // ── Facts strip
    if (m.facts.length) {
      ensure(40)
      const fh = 36, cw = CW / m.facts.length
      doc.roundedRect(MX, y, CW, fh, 10).lineWidth(1).strokeColor(C.line).stroke()
      m.facts.forEach((f, i) => {
        const fx = MX + i * cw
        if (i > 0) doc.moveTo(fx, y).lineTo(fx, y + fh).strokeColor(C.line).stroke()
        t(f.label, fx + 10, y + 7, { f: 'sb', size: 7.5, color: C.faint, width: cw - 14 })
        t(f.value, fx + 10, y + 18, { f: 'b', size: 10, width: cw - 14 })
      })
      y += fh + 8
    }

    // ── Package / booked-window bars
    if (m.package && m.package.bars.length) {
      const ph = 30 + m.package.bars.length * 16
      ensure(ph + 8)
      doc.roundedRect(MX, y, CW, ph, 10).lineWidth(1).strokeColor(C.line).stroke()
      t(m.package.title, MX + 12, y + 9, { f: 'b', size: 9, width: CW / 2 })
      if (m.package.sub) t(m.package.sub, MX, y + 9, { f: 'sb', size: 8.5, color: C.muted, width: CW - 12, align: 'right' })
      m.package.bars.forEach((b, i) => {
        const by = y + 28 + i * 16
        t(b.label, MX + 12, by - 1, { f: 'sb', size: 8.5, color: C.muted, width: 56 })
        const label = `${b.used}  +${b.extra}`
        const lw = w(label, 8.5, 'b') + 2
        const bx = MX + 74, bw = CW - 74 - 14 - lw - 8
        doc.roundedRect(bx, by + 1, bw, 6, 3).fill('#E8F1F1')
        doc.roundedRect(bx, by + 1, bw, 6, 3).fill(C.gold)
        doc.rect(bx + bw * Math.min(100 / Math.max(b.pct, 100), 1) - 1, by - 1, 2, 10).fill(C.ink)
        t(b.used, MX + CW - 12 - lw, by - 1, { f: 'b', size: 8.5, width: lw, align: 'left' })
        t(`+${b.extra}`, MX + CW - 12 - lw + w(`${b.used} `, 8.5, 'b'), by - 1, { f: 'b', size: 8.5, color: C.amber, width: lw })
      })
      y += ph + 8
    }

    // ── Driver and vehicle
    if (m.driver) {
      const ch = 56, cw2 = (CW - 12) / 2
      ensure(ch + 12)
      y += 4
      doc.roundedRect(MX, y, cw2, ch, 10).lineWidth(1).strokeColor(C.line).stroke()
      doc.roundedRect(MX + cw2 + 12, y, cw2, ch, 10).stroke()
      const ini = m.driver.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()
      doc.circle(MX + 28, y + ch / 2, 16).fill(C.tealWash)
      t(ini, MX + 12, y + ch / 2 - 6, { f: 'xb', size: 11, color: C.tealText, width: 32, align: 'center' })
      t(m.kind === 'cancelled' ? 'Assigned driver' : 'You rode with', MX + 54, y + 10, { f: 'sb', size: 7.5, color: C.faint, width: cw2 - 60 })
      t(m.driver.name, MX + 54, y + 21, { f: 'b', size: 10.5, width: cw2 - 60 })
      if (m.driver.rating) t(`★ ${m.driver.rating}`, MX + 54, y + 36, { f: 'b', size: 9, width: cw2 - 60 })
      const vx = MX + cw2 + 12 + 12
      t('Vehicle', vx, y + 8, { f: 'sb', size: 7.5, color: C.faint, width: cw2 - 24 })
      t(m.driver.vehicle || '—', vx, y + 18, { f: 'b', size: 10.5, width: cw2 - 24 })
      if (m.driver.plate) {
        const pw2 = w(m.driver.plate, 10.5, 'xb') + 22 + 16
        doc.roundedRect(vx, y + 33, pw2, 17, 4).fill(C.plate)
        doc.save().roundedRect(vx, y + 33, 15, 17, 4).clip().rect(vx, y + 33, 15, 17).fill(C.plateBlue).restore()
        t('IND', vx, y + 39, { f: 'b', size: 5, color: '#FFFFFF', width: 15, align: 'center' })
        doc.roundedRect(vx, y + 33, pw2, 17, 4).lineWidth(1.4).strokeColor(C.ink).stroke()
        t(m.driver.plate, vx + 15, y + 37, { f: 'xb', size: 10.5, width: pw2 - 15, align: 'center', spacing: 0.8 })
      }
      y += ch + 10
    }

    // ── Fare table: the heading repeats on a new page; the total never stands alone
    const rowH = 21
    const head = () => { caps('Fare', MX, y); y += 14 }
    ensure(14 + rowH * Math.min(m.rows.length + 1, 3) + 20)
    head()
    const draw = (label: string, detail: string | undefined, amount: number, o: { off?: boolean; muted?: boolean; sum?: boolean } = {}) => {
      if (o.sum) {
        doc.moveTo(MX, y + 2).lineTo(MX + CW, y + 2).lineWidth(1.2).strokeColor(C.ink).stroke()
        t(label, MX, y + 12, { f: 'xb', size: 11.5 })
        t(`${amount < 0 ? '−' : ''}${money(amount)}`, MX, y + 9, { f: 'xb', size: 16, width: CW, align: 'right' })
        y += 34
        return
      }
      const ink = o.off ? C.green : o.muted ? C.muted : C.ink
      t(label, MX, y + 5, { f: o.muted ? 'b' : 'sb', size: 10, color: ink, width: CW })
      if (detail) t(detail, MX + w(label, 10, o.muted ? 'b' : 'sb') + 7, y + 6.5, { size: 8.5, color: C.muted, width: CW - 120 })
      t(`${amount < 0 ? '−' : ''}${money(amount)}`, MX, y + 5, { f: 'sb', size: 10, color: ink, width: CW, align: 'right' })
      if (!o.muted) doc.moveTo(MX, y + rowH - 1).lineTo(MX + CW, y + rowH - 1).lineWidth(0.6).strokeColor(C.hair).stroke()
      y += rowH
    }
    const lines: Array<() => void> = []
    const total = m.rows.length
    m.rows.forEach((r, i) => lines.push(() => {
      // keep the last two rows (and the total) together
      if (i >= total - 2) ensure(rowH * (total - i) + 36 + (m.offer > 0 ? rowH * 2 : 0)) ? head() : undefined
      else if (ensure(rowH)) head()
      draw(r.label, r.detail, r.amount)
    }))
    lines.forEach((f) => f())
    if (m.offer > 0) {
      if (ensure(rowH * 2 + 40)) head()
      draw('Fare before offer', undefined, m.total + m.offer, { muted: true })
      draw('Offer', undefined, -m.offer, { off: true })
    }
    if (ensure(36)) head()
    draw(m.sumLabel, undefined, m.total, { sum: true })

    // ── Footer on every page
    const range = doc.bufferedPageRange()
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i)
      doc.moveTo(MX, PH - 54).lineTo(PW - MX, PH - 54).lineWidth(0.6).strokeColor(C.line).stroke()
      t('This is a trip receipt, not a tax invoice.', MX, PH - 48, { f: 'b', size: 6.8, width: CW - 70 })
      t('No GST is recovered from you on this trip. Issued by OD CAR RENTALS PRIVATE LIMITED, LIG-873 K-4, Kalinga Vihar, Patrapada, Bhubaneswar, Odisha 751019. support@ocarindia.com · +91 95565 37170 (7 am to 10 pm daily). Receipt issued ' + m.issuedLabel + '.', MX, PH - 40, { size: 6.8, color: C.muted, width: CW - 70 })
      t(`Page ${i + 1} of ${range.count}`, MX, PH - 48, { f: 'sb', size: 6.8, color: C.muted, width: CW, align: 'right' })
    }
    doc.end()
  })
}

/** The route as a clean diagram in the app's palette: pale teal panel, white casing under a teal line, start/stop/end pins. No map provider. */
function drawRoute(doc: PDFKit.PDFDocument, m: ReceiptModel, x: number, y: number, w: number, h: number): void {
  doc.save()
  doc.roundedRect(x, y, w, h, 12).clip()
  doc.rect(x, y, w, h).fill(C.mapBg)
  const pts: Array<[number, number]> = m.trail.length >= 2 ? m.trail : m.pins.map((p) => [p.lat, p.lng] as [number, number])
  const all = [...pts, ...m.pins.map((p) => [p.lat, p.lng] as [number, number])]
  const lats = all.map((p) => p[0]), lngs = all.map((p) => p[1])
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const k = Math.cos(((minLat + maxLat) / 2) * Math.PI / 180)
  const spanX = Math.max((maxLng - minLng) * k, 1e-5), spanY = Math.max(maxLat - minLat, 1e-5)
  const pad = 26
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY)
  const offX = x + (w - spanX * scale) / 2, offY = y + (h - spanY * scale) / 2
  const proj = (lat: number, lng: number): [number, number] => [offX + (lng - minLng) * k * scale, offY + (maxLat - lat) * scale]
  // faint grid so the panel reads as a map, not an empty box
  doc.lineWidth(0.5).strokeColor('#DCEBEC')
  for (let gx = x + 24; gx < x + w; gx += 48) doc.moveTo(gx, y).lineTo(gx, y + h).stroke()
  for (let gy = y + 24; gy < y + h; gy += 48) doc.moveTo(x, gy).lineTo(x + w, gy).stroke()
  const path = pts.map((p) => proj(p[0], p[1]))
  const line = (col: string, wd: number) => { doc.lineWidth(wd).lineCap('round').lineJoin('round').strokeColor(col); path.forEach((p, i) => (i ? doc.lineTo(p[0], p[1]) : doc.moveTo(p[0], p[1]))); doc.stroke() }
  line('#FFFFFF', 7.5)
  line(C.teal, 3.6)
  for (const p of m.pins) {
    const [px, py] = proj(p.lat, p.lng)
    if (p.kind === 'start') doc.circle(px, py, 5.5).lineWidth(3).fillAndStroke('#FFFFFF', C.teal)
    else if (p.kind === 'end') doc.roundedRect(px - 5, py - 5, 10, 10, 2).lineWidth(3).fillAndStroke('#FFFFFF', C.ink)
    else doc.circle(px, py, 3.2).lineWidth(2).fillAndStroke('#FFFFFF', C.faint)
  }
  doc.restore()
  doc.roundedRect(x, y, w, h, 12).lineWidth(1).strokeColor(C.line).stroke()
}
