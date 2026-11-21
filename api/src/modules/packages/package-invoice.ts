import { createHmac, timingSafeEqual } from 'node:crypto'

// Pure rules for the GST tax invoice a driver gets for a ride-credit purchase. No I/O here, so every rule is unit-tested.
//
// What the law asks of the invoice (CGST Act s.31, CGST Rules 46-47, IGST Act s.12):
//   * a consecutive serial number, at most 16 characters, unique within the financial year;
//   * supplier name, address and GSTIN; recipient name and address; the SAC; the taxable value; each tax with its rate and amount;
//   * CGST + SGST when the place of supply is in the supplier's state, IGST when it is in another state;
//   * for a service sold to a person who is not registered, the place of supply is the recipient's address on record, else the supplier's
//     location (so no address on record means CGST + SGST).

const STATE_CODES: Record<string, string> = {
  'jammu and kashmir': '01', 'jammu & kashmir': '01', 'himachal pradesh': '02', 'punjab': '03', 'chandigarh': '04', 'uttarakhand': '05',
  'haryana': '06', 'delhi': '07', 'new delhi': '07', 'rajasthan': '08', 'uttar pradesh': '09', 'bihar': '10', 'sikkim': '11',
  'arunachal pradesh': '12', 'nagaland': '13', 'manipur': '14', 'mizoram': '15', 'tripura': '16', 'meghalaya': '17', 'assam': '18',
  'west bengal': '19', 'jharkhand': '20', 'odisha': '21', 'orissa': '21', 'chhattisgarh': '22', 'madhya pradesh': '23', 'gujarat': '24',
  'dadra and nagar haveli and daman and diu': '26', 'dadra and nagar haveli': '26', 'daman and diu': '26', 'maharashtra': '27',
  'karnataka': '29', 'goa': '30', 'lakshadweep': '31', 'kerala': '32', 'tamil nadu': '33', 'puducherry': '34', 'pondicherry': '34',
  'andaman and nicobar islands': '35', 'telangana': '36', 'andhra pradesh': '37', 'ladakh': '38',
}

/** The two-digit GST state code for a state name as drivers type it, or null when it is blank or not a state we know. */
export function stateCodeOf(name: string | null | undefined): string | null {
  const key = (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  return STATE_CODES[key] ?? null
}

/** A GSTIN is 15 characters: state code, PAN, entity number, 'Z', check character. Format only; the check digit is not recomputed. */
export function isValidGstin(v: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)
}

const IST_OFFSET_MS = 5.5 * 3_600_000

/** The financial year (April to March, by the Indian calendar) a moment falls in, as '2627' for April 2026 to March 2027. */
export function fyCodeOf(at: Date): string {
  const ist = new Date(at.getTime() + IST_OFFSET_MS)
  const startYear = ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1
  return `${String(startYear % 100).padStart(2, '0')}${String((startYear + 1) % 100).padStart(2, '0')}`
}

/** 'PK/2627/000042' (package) or 'CM/2627/000042' (commission): at most 16 characters, as Rule 46 requires. */
export function formatInvoiceNo(fyCode: string, seq: number, series: 'PK' | 'CM' = 'PK'): string {
  if (!Number.isInteger(seq) || seq < 1 || seq > 999_999) throw new Error(`invoice sequence out of range: ${seq}`)
  return `${series}/${fyCode}/${String(seq).padStart(6, '0')}`
}

export interface TaxSplit {
  igst: boolean
  cgstRate: number; cgst: number
  sgstRate: number; sgst: number
  igstRate: number; igstAmount: number
  total: number
}

/**
 * Splits the GST already charged on the order into its lines. `gst` is what the driver paid in tax, so the lines always add up to it: in an
 * intra-state sale CGST and SGST are half each (an odd paisa goes to CGST); in an inter-state sale it is all IGST.
 */
export function splitTax(taxable: number, gst: number, gstPercent: number, intraState: boolean): TaxSplit {
  const taxablePaise = Math.round(taxable * 100)
  const gstPaise = Math.round(gst * 100)
  const to = (paise: number) => paise / 100
  if (!intraState) {
    return { igst: true, cgstRate: 0, cgst: 0, sgstRate: 0, sgst: 0, igstRate: gstPercent, igstAmount: to(gstPaise), total: to(taxablePaise + gstPaise) }
  }
  const sgstPaise = Math.floor(gstPaise / 2)
  const cgstPaise = gstPaise - sgstPaise
  const half = Math.round((gstPercent / 2) * 100) / 100
  return { igst: false, cgstRate: half, cgst: to(cgstPaise), sgstRate: half, sgst: to(sgstPaise), igstRate: 0, igstAmount: 0, total: to(taxablePaise + gstPaise) }
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
  'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function below1000(n: number): string {
  const parts: string[] = []
  if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100 }
  if (n >= 20) { parts.push(TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${ONES[n % 10]}` : '')) }
  else if (n > 0) parts.push(ONES[n]!)
  return parts.join(' ')
}

function wholeInWords(n: number): string {
  if (n === 0) return 'Zero'
  const crore = Math.floor(n / 10_000_000), lakh = Math.floor((n % 10_000_000) / 100_000)
  const thousand = Math.floor((n % 100_000) / 1_000), rest = n % 1_000
  const parts: string[] = []
  if (crore) parts.push(`${below1000(crore)} Crore`)
  if (lakh) parts.push(`${below1000(lakh)} Lakh`)
  if (thousand) parts.push(`${below1000(thousand)} Thousand`)
  if (rest) parts.push(below1000(rest))
  return parts.join(' ')
}

/** 47.2 -> 'Rupees Forty Seven and Twenty Paise Only' (Indian numbering: thousand, lakh, crore). */
export function rupeesInWords(amount: number): string {
  const paiseTotal = Math.round(amount * 100)
  const rupees = Math.floor(paiseTotal / 100), paise = paiseTotal % 100
  return `Rupees ${wholeInWords(rupees)}${paise ? ` and ${wholeInWords(paise)} Paise` : ''} Only`
}

/** What the plan is called on the invoice line. */
export function invoiceDescription(thresholdValue: number, validityDays: number): string {
  return `Ride-credit plan: platform access, ride credit of Rs ${thresholdValue.toLocaleString('en-IN')}, valid ${validityDays} days`
}

// ── Signed download link ────────────────────────────────────────────────────
// The app opens the PDF in a browser tab, which cannot carry the app's login header, so the API hands out a short-lived link instead:
// invoiceId.driverId.expiry.signature, signed with a server secret. Anyone holding a live link can read that one invoice until it expires.

const sig = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('base64url')

export function signInvoiceLink(invoiceId: string, driverId: string, expiresAtSec: number, secret: string): string {
  const body = `${invoiceId}.${driverId}.${expiresAtSec}`
  return `${body}.${sig(secret, body)}`
}

/** Returns the invoice id when the link is genuine and not expired, else null. */
export function verifyInvoiceLink(token: string, secret: string, nowSec: number): { invoiceId: string; driverId: string } | null {
  const parts = token.split('.')
  if (parts.length !== 4) return null
  const [invoiceId, driverId, exp, given] = parts as [string, string, string, string]
  const expected = sig(secret, `${invoiceId}.${driverId}.${exp}`)
  const a = Buffer.from(given), b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  if (!/^\d+$/.test(exp) || Number(exp) < nowSec) return null
  return { invoiceId, driverId }
}
