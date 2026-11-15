import { z } from 'zod'
import { httpError } from '@/lib/errors'

// One place that decides what a stored person's name looks like, for drivers, riders and the contacts they add.
//
// Two jobs, kept apart:
//   cleanPersonName   -> tidy what was typed (Unicode, invisible characters, spaces, capitals). Never rejects.
//   checkPersonName   -> decide whether the tidy result is acceptable as a name (length, has letters, no links/emoji).
// normalizePersonName runs both and is what write paths call.
//
// Guarantees (tested): idempotent (cleaning twice == cleaning once), and a name that is already well-formed comes back
// unchanged. We never "correct" a name a person typed with deliberate capitals (McDonald, D'Souza, SK Das): only words
// typed entirely in lower case, or SHOUTED in 3+ capitals, are changed. Scripts without letter case (Odia, Devanagari,
// ...) pass through untouched.

export type NameOptions = {
  /** Minimum characters after cleaning (counted as characters a person sees, not UTF-16 units). */
  min: number
  /** Maximum characters after cleaning. */
  max: number
}

export type NameResult = { ok: true; name: string } | { ok: false; message: string }

// Zero-width joiner / non-joiner are real parts of some Indic and Persian spellings, so they are kept inside a name
// (but never at its edges). Every other invisible "format" character (zero-width space, bidi controls, BOM, soft hyphen)
// is only ever noise or a spoofing trick, and is removed.
const KEEP_FORMAT = new Set([0x200c, 0x200d])
const SEPARATORS = /([-'’.])/

function stripInvisible(s: string): string {
  let out = ''
  for (const ch of s) {
    if (/\p{Cc}/u.test(ch)) { out += ' '; continue }                       // tabs, newlines, other controls
    if (/\p{Cf}/u.test(ch) && !KEEP_FORMAT.has(ch.codePointAt(0)!)) continue
    out += ch
  }
  return out
}

function capFirstLetter(seg: string): string {
  return seg.replace(/\p{L}/u, (c) => c.toUpperCase())
}

function fixSegment(seg: string): string {
  const hasLower = /\p{Ll}/u.test(seg)
  const hasUpper = /\p{Lu}/u.test(seg)
  if (hasLower && !hasUpper) return capFirstLetter(seg)                    // "sujal"   -> "Sujal"
  if (hasUpper && !hasLower && (seg.match(/\p{L}/gu)?.length ?? 0) >= 3) {  // "SAHOO"   -> "Sahoo"  (but "SK", "B" stay)
    return capFirstLetter(seg.toLowerCase())
  }
  return seg                                                                // "McDonald", "SK", uncased scripts
}

function fixWord(word: string): string {
  // "abdul-rahman" -> "Abdul-Rahman", "d'souza" -> "D'Souza", "b.k.sahoo" -> "B.K.Sahoo"
  return word.split(SEPARATORS).map((part, i) => (i % 2 === 1 ? part : fixSegment(part))).join('')
}

export function cleanPersonName(input: string): string {
  let s = input.normalize('NFC')
  s = stripInvisible(s)
  s = s.replace(/[\p{Z}\s]+/gu, ' ').trim()
  s = s.replace(/^[‌‍]+|[‌‍]+$/g, '').trim()
  s = s.split(' ').map(fixWord).join(' ')
  return s.normalize('NFC')
}

const charCount = (s: string) => Array.from(s).length

/** Why a cleaned name is not acceptable, or null. Messages are written for the person typing. */
export function checkPersonName(name: string, { min, max }: NameOptions): string | null {
  const n = charCount(name)
  if (n === 0) return 'Enter a name'
  if (n < min) return `Name must be at least ${min} characters`
  if (n > max) return `Name must be at most ${max} characters`
  const letters = name.match(/\p{L}/gu)?.length ?? 0
  if (letters < Math.min(min, 2)) return 'Name must contain letters'
  if (/\p{Extended_Pictographic}/u.test(name)) return "Name can't include emoji"
  if (/[<>@]|:\/\/|\bwww\.|\d{4,}/i.test(name)) return "Name can't include links, email addresses, long numbers or symbols like < >"
  return null
}

export function normalizePersonName(raw: string, opts: NameOptions): NameResult {
  // Bound the work done on hostile input before any regex runs; a legitimate name is nowhere near this.
  if (raw.length > opts.max * 4 + 40) return { ok: false, message: `Name must be at most ${opts.max} characters` }
  const name = cleanPersonName(raw)
  const problem = checkPersonName(name, opts)
  return problem ? { ok: false, message: problem } : { ok: true, name }
}

/** For write paths: the cleaned name, or a 422 with a message fit to show the person. */
export function requirePersonName(raw: string, opts: NameOptions): string {
  const r = normalizePersonName(raw, opts)
  if (!r.ok) throw httpError(422, r.message, 'VALIDATION_ERROR')
  return r.name
}

/** Zod schema for request validation. The middleware only validates (it does not replace the body), so write paths must
 *  still call cleanPersonName / normalizePersonName on the value they store. */
export const personNameSchema = (opts: NameOptions) =>
  z.string().superRefine((raw, ctx) => {
    const r = normalizePersonName(raw, opts)
    if (!r.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.message })
  })
