import PDFDocument from 'pdfkit'
import fs from 'node:fs'
import path from 'node:path'
import { rupeesInWords } from './package-invoice'
import type { PackageInvoice } from './package-invoice.service'

// Draws a package GST tax invoice as a one-page A4 PDF with pdfkit (pure JS, no browser). Fonts and logo are read once.
// Names and addresses a driver typed in Odia are drawn in an Odia font run by run, since Plus Jakarta Sans has no Odia and Noto Sans Oriya
// has no Latin letters.

const ASSETS = path.resolve(__dirname, '../../../assets')
const FONT = {
  reg: path.join(ASSETS, 'fonts/PlusJakartaSans_400Regular.ttf'),
  sb: path.join(ASSETS, 'fonts/PlusJakartaSans_600SemiBold.ttf'),
  b: path.join(ASSETS, 'fonts/PlusJakartaSans_700Bold.ttf'),
  xb: path.join(ASSETS, 'fonts/PlusJakartaSans_800ExtraBold.ttf'),
  odia: path.join(ASSETS, 'fonts/NotoSansOriya.ttf'),
}
const FONT_BUF: Record<string, Buffer> = Object.fromEntries(Object.entries(FONT).map(([k, p]) => [k, fs.readFileSync(p)]))
const LOGO_BUF = fs.readFileSync(path.join(ASSETS, 'logo-mark.png'))

const C = { ink: '#14171A', muted: '#5F6468', label: '#6B7176', line: '#E4E7E9', wash: '#F4F7F8', teal: '#0E8FA3', tealText: '#0A7788', tealWash: '#E8F4F6' }
const PW = 595.28, MX = 42, CW = PW - MX * 2
const ODIA = /[଀-୿]/
const ODIA_RUN = /([଀-୿‌‍]+)/

type Font = keyof typeof FONT

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const rate = (r: number) => `${Number.isInteger(r) ? r : r.toFixed(2)}%`
/** 'YYYY-MM-DD' (an IST calendar date) as '01 Oct 2026'. */
const dateIso = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : '')
const dateIst = (iso: string | Date) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' })

export function renderPackageInvoicePdf(inv: PackageInvoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 0, bottom: 0, left: 0, right: 0 },
      info: { Title: `Tax invoice ${inv.invoice_no}`, Author: inv.supplier.name, Subject: 'GST tax invoice' },
    })
    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    for (const [k, b] of Object.entries(FONT_BUF)) doc.registerFont(k, b)

    const runsOf = (s: string, base: Font) => s.split(ODIA_RUN).filter(Boolean).map((text) => ({ text, font: (ODIA.test(text) ? 'odia' : base) as Font }))
    const wOf = (s: string, size: number, f: Font) => runsOf(s, f).reduce((n, r) => { doc.font(r.font).fontSize(size); return n + doc.widthOfString(r.text) }, 0)
    // Text at (x, y). A string without Odia is one call; one with Odia is drawn run by run so each run has its own font.
    const t = (s: string, x: number, y: number, o: { f?: Font; size?: number; color?: string; width?: number; align?: 'left' | 'right' | 'center' } = {}) => {
      const base = o.f ?? 'reg', size = o.size ?? 9, align = o.align ?? 'left'
      doc.fillColor(o.color ?? C.ink)
      if (!ODIA.test(s)) {
        doc.font(base).fontSize(size).text(s, x, y, { width: o.width ?? CW, align, lineBreak: o.width != null })
        return
      }
      const total = wOf(s, size, base)
      let cx = align === 'right' ? x + (o.width ?? CW) - total : align === 'center' ? x + ((o.width ?? CW) - total) / 2 : x
      for (const r of runsOf(s, base)) { doc.font(r.font).fontSize(size).text(r.text, cx, y, { lineBreak: false }); cx += doc.widthOfString(r.text) }
    }
    const hOf = (s: string, size: number, width: number, f: Font = 'reg') => { doc.font(ODIA.test(s) ? 'odia' : f).fontSize(size); return doc.heightOfString(s, { width }) }
    const caps = (s: string, x: number, y: number) => t(s.toUpperCase(), x, y, { f: 'b', size: 7, color: C.label })

    // ── Masthead
    let y = 40
    doc.image(LOGO_BUF, MX, y, { height: 28 })
    t('TAX INVOICE', MX, y + 1, { f: 'xb', size: 15, color: C.tealText, width: CW, align: 'right' })
    t('Original for recipient', MX, y + 19, { size: 8, color: C.muted, width: CW, align: 'right' })
    y += 46
    doc.moveTo(MX, y).lineTo(MX + CW, y).lineWidth(0.8).strokeColor(C.line).stroke()
    y += 14

    // ── Invoice facts
    const place = inv.recipient.state_name && inv.recipient.state_code
      ? `${inv.recipient.state_name} (${inv.place_of_supply_code})` : `Code ${inv.place_of_supply_code}`
    const facts: Array<[string, string]> = [['Invoice number', inv.invoice_no], ['Invoice date', dateIst(inv.issued_at)], ['Place of supply', place], ['Reverse charge', 'No']]
    const fw = CW / facts.length
    facts.forEach(([label, value], i) => { caps(label, MX + i * fw, y); t(value, MX + i * fw, y + 11, { f: 'b', size: 10, width: fw - 8 }) })
    y += 40

    // ── Supplier and recipient
    const colW = (CW - 16) / 2
    const party = (title: string, p: PackageInvoice['supplier'], x: number, withGstin: boolean) => {
      let yy = y + 12
      caps(title, x + 12, yy); yy += 13
      t(p.name, x + 12, yy, { f: 'b', size: 10.5, width: colW - 24 }); yy += hOf(p.name, 10.5, colW - 24, 'b') + 3
      if (p.address) { t(p.address, x + 12, yy, { size: 9, color: C.muted, width: colW - 24 }); yy += hOf(p.address, 9, colW - 24) + 3 }
      if (withGstin && p.gstin) { t(`GSTIN  ${p.gstin}`, x + 12, yy, { f: 'sb', size: 9, width: colW - 24 }); yy += 13 }
      if (!withGstin && p.phone) { t(`Phone  ${p.phone}`, x + 12, yy, { size: 9, color: C.muted, width: colW - 24 }); yy += 13 }
      if (p.state_code) { t(`State code  ${p.state_code}`, x + 12, yy, { size: 9, color: C.muted, width: colW - 24 }); yy += 13 }
      return yy + 10
    }
    const yStart = y
    const endA = party('Supplier', inv.supplier, MX, true)
    const endB = party('Billed to', inv.recipient, MX + colW + 16, false)
    const boxH = Math.max(endA, endB) - yStart
    doc.roundedRect(MX, yStart, colW, boxH, 8).lineWidth(0.8).strokeColor(C.line).stroke()
    doc.roundedRect(MX + colW + 16, yStart, colW, boxH, 8).lineWidth(0.8).strokeColor(C.line).stroke()
    y = yStart + boxH + 20

    // ── Line table
    const cols = [{ x: MX, w: 196 }, { x: MX + 196, w: 56 }, { x: MX + 252, w: 78 }, { x: MX + 330, w: 101 }, { x: MX + 431, w: 80 }]
    doc.rect(MX, y, CW, 22).fill(C.wash)
    const head = ['Description', 'SAC', 'Taxable value', 'Tax', 'Amount']
    head.forEach((s, i) => t(s.toUpperCase(), cols[i]!.x + 8, y + 7.5, { f: 'b', size: 7, color: C.label, width: cols[i]!.w - 16, align: i >= 2 ? 'right' : 'left' }))
    y += 22
    const intra = inv.igst_amount === 0
    const taxLines = intra
      ? [`CGST ${rate(inv.cgst_rate)}  ${inr(inv.cgst_amount)}`, `SGST ${rate(inv.sgst_rate)}  ${inr(inv.sgst_amount)}`]
      : [`IGST ${rate(inv.igst_rate)}  ${inr(inv.igst_amount)}`]
    const rowH = Math.max(hOf(inv.description, 9, cols[0]!.w - 16), taxLines.length * 13) + 20
    t(inv.description, cols[0]!.x + 8, y + 10, { size: 9, width: cols[0]!.w - 16 })
    t(inv.sac, cols[1]!.x + 8, y + 10, { size: 9, width: cols[1]!.w - 16 })
    t(inr(inv.taxable_value), cols[2]!.x + 8, y + 10, { size: 9, width: cols[2]!.w - 16, align: 'right' })
    taxLines.forEach((s, i) => t(s, cols[3]!.x + 8, y + 10 + i * 13, { size: 8.5, color: C.muted, width: cols[3]!.w - 16, align: 'right' }))
    t(inr(inv.total), cols[4]!.x + 8, y + 10, { f: 'b', size: 9, width: cols[4]!.w - 16, align: 'right' })
    y += rowH
    doc.moveTo(MX, y).lineTo(MX + CW, y).lineWidth(0.8).strokeColor(C.line).stroke()
    y += 18

    // ── Totals
    const tw = 230, tx = MX + CW - tw
    const line = (label: string, value: string, strong = false) => {
      t(label, tx, y, { f: strong ? 'b' : 'reg', size: strong ? 10.5 : 9, color: strong ? C.ink : C.muted, width: tw - 90 })
      t(value, tx, y, { f: strong ? 'xb' : 'sb', size: strong ? 12 : 9, color: strong ? C.tealText : C.ink, width: tw, align: 'right' })
      y += strong ? 22 : 16
    }
    line('Taxable value', inr(inv.taxable_value))
    if (intra) { line(`CGST ${rate(inv.cgst_rate)}`, inr(inv.cgst_amount)); line(`SGST ${rate(inv.sgst_rate)}`, inr(inv.sgst_amount)) }
    else line(`IGST ${rate(inv.igst_rate)}`, inr(inv.igst_amount))
    y += 2
    doc.roundedRect(tx - 10, y - 6, tw + 10, 28, 6).fill(C.tealWash)
    y += 2
    line('Total invoice value', inr(inv.total), true)
    y += 6
    t('Amount in words', MX, y, { f: 'b', size: 7, color: C.label })
    t(rupeesInWords(inv.total), MX, y + 11, { f: 'sb', size: 9.5, width: CW })
    y += 38

    // ── Payment and notes
    const commission = inv.kind === 'commission'
    doc.roundedRect(MX, y, CW, 44, 8).fill(C.wash)
    if (commission) {
      t('Deducted from your Ocar wallet', MX + 14, y + 10, { f: 'b', size: 9 })
      t(`Commission for ${inv.ride_count ?? 0} ${inv.ride_count === 1 ? 'ride' : 'rides'} from ${dateIso(inv.period_start)} to ${dateIso(inv.period_end)}, deducted ride by ride. The rides are listed on the next page.`,
        MX + 14, y + 24, { size: 8.5, color: C.muted, width: CW - 28 })
    } else {
      t('Paid online', MX + 14, y + 10, { f: 'b', size: 9 })
      t(inv.gateway_payment_id ? `Payment reference ${inv.gateway_payment_id}` : 'Paid through the Ocar driver app', MX + 14, y + 24, { size: 8.5, color: C.muted, width: CW - 28 })
    }
    y += 64
    t(commission
      ? 'The commission deducted on each ride already includes GST. This invoice shows the tax contained in the total deducted for the period, so no further amount is payable.'
      : 'Ride credit bought with this invoice is prepaid value against ride fares and is valid for the period stated above. Credit not used within that period lapses and is not refunded.',
      MX, y, { size: 8, color: C.muted, width: CW })
    y += 38

    // ── Signature block and footer
    t(`For ${inv.supplier.name}`, MX, y, { f: 'sb', size: 9, width: CW, align: 'right' })
    t('Authorised signatory', MX, y + 14, { size: 8, color: C.muted, width: CW, align: 'right' })
    t('This is a computer-generated tax invoice.', MX, 800, { size: 7.5, color: C.label, width: CW, align: 'center' })

    // ── Annexure: the rides a commission invoice covers, as many pages as it takes
    if (commission && inv.lines && inv.lines.length > 0) {
      const lineCols = [{ x: MX, w: 130, a: 'left' as const }, { x: MX + 130, w: 150, a: 'left' as const }, { x: MX + 280, w: 110, a: 'right' as const }, { x: MX + 390, w: 121, a: 'right' as const }]
      const startPage = () => {
        doc.addPage()
        let yy = 40
        t(`Annexure to invoice ${inv.invoice_no}`, MX, yy, { f: 'xb', size: 12, color: C.tealText, width: CW })
        t(`Rides covered: ${dateIso(inv.period_start)} to ${dateIso(inv.period_end)}. Amounts include GST.`, MX, yy + 17, { size: 8.5, color: C.muted, width: CW })
        yy += 40
        doc.rect(MX, yy, CW, 20).fill(C.wash)
        ;['Date and time (IST)', 'Ride', 'Fare', 'Commission (incl. GST)'].forEach((s, i) =>
          t(s.toUpperCase(), lineCols[i]!.x + 8, yy + 6.5, { f: 'b', size: 7, color: C.label, width: lineCols[i]!.w - 16, align: lineCols[i]!.a }))
        return yy + 20
      }
      let yy = startPage()
      for (const ln of inv.lines) {
        if (yy > 770) yy = startPage()
        const when = new Date(ln.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
        t(when, lineCols[0]!.x + 8, yy + 5, { size: 8.5, width: lineCols[0]!.w - 16 })
        t(ln.ride_id ? `Ride #${ln.ride_id}` : 'Ride', lineCols[1]!.x + 8, yy + 5, { size: 8.5, width: lineCols[1]!.w - 16 })
        t(ln.fare === null ? '' : inr(ln.fare), lineCols[2]!.x + 8, yy + 5, { size: 8.5, width: lineCols[2]!.w - 16, align: 'right' })
        t(inr(ln.commission), lineCols[3]!.x + 8, yy + 5, { f: 'sb', size: 8.5, width: lineCols[3]!.w - 16, align: 'right' })
        yy += 18
        doc.moveTo(MX, yy).lineTo(MX + CW, yy).lineWidth(0.4).strokeColor(C.line).stroke()
      }
      yy += 8
      t('Total commission deducted', MX, yy + 4, { f: 'b', size: 9, width: lineCols[3]!.x - MX + 120 - 140 })
      t(inr(inv.total), MX, yy + 4, { f: 'xb', size: 10, color: C.tealText, width: CW - 8, align: 'right' })
    }

    doc.end()
  })
}
