import { z } from 'zod'
import { httpError } from '@/lib/errors'

// One place that decides what a stored person's name looks like, for drivers, riders and the people they add.
//
// Two jobs, kept apart:
//   cleanPersonName   -> tidy what was typed (Unicode, invisible characters, spaces, capitals). Never rejects.
//   checkPersonName   -> decide whether the tidy result is acceptable as a name (length, has letters, no links/emoji).
// normalizePersonName runs both and is what write paths call.
//
// Guarantees (tested): idempotent (cleaning twice == cleaning once), and a name that is already well-formed comes back
// unchanged. We never "correct" a name a person typed with deliberate capitals (McDonald, D'Souza, SK Das, KRS Naidu):
// words typed entirely in lower case are capitalised, and a name typed ENTIRELY in capitals is title-cased. Scripts
// without letter case (Odia, Devanagari, ...) pass through untouched.

export type NameOptions = {
  /** Minimum characters after cleaning (counted as characters a person sees, not UTF-16 units). */
  min: number
  /** Maximum characters after cleaning. */
  max: number
}

export type NameResult = { ok: true; name: string } | { ok: false; message: string }

// Bound the work done on hostile input before any regex runs. Far above any real name plus heavy padding.
const MAX_RAW_LENGTH = 2000

// Zero-width joiner / non-joiner are real parts of some Indic and Persian spellings, so they are kept inside a word
// (but never at a word's edge). Every other invisible "format" character (zero-width space, bidi controls, BOM, soft
// hyphen) is only ever noise or a spoofing trick, and is removed.
const JOINERS = '‌‍'
const FORMAT_CHAR = /\p{Cf}/gu
const CONTROL_CHAR = /\p{Cc}/gu
const WORD_EDGE_JOINERS = new RegExp(`[${JOINERS}]+(?= |$)|(?<=^| )[${JOINERS}]+`, 'g')
const SEPARATORS = /([-'’.])/

const letterCount = (s: string) => s.match(/\p{L}/gu)?.length ?? 0
const capFirstLetter = (seg: string) => seg.replace(/\p{L}/u, (c) => c.toUpperCase())
const hasLower = (s: string) => /\p{Ll}/u.test(s)
const hasUpper = (s: string) => /\p{Lu}/u.test(s)

// Capitalise the first letter of a lower-case-only segment; with `titleCaps`, also bring an ALL-CAPS segment of 3+
// letters down to Title case ("SAHOO" -> "Sahoo"; two-letter "SK" stays, it is almost always initials).
function fixSegment(seg: string, titleCaps: boolean): string {
  if (hasLower(seg) && !hasUpper(seg)) return capFirstLetter(seg)
  if (titleCaps && hasUpper(seg) && !hasLower(seg) && letterCount(seg) >= 3) return capFirstLetter(seg.toLowerCase())
  return seg
}

// "abdul-rahman" -> "Abdul-Rahman", "d'souza" -> "D'Souza", "b.k.sahoo" -> "B.K.Sahoo", but "dad's" stays "Dad's":
// after an apostrophe only a one-letter prefix (D', O', L') starts a new capital; after a dot only a short one (initials, Dr.).
function fixWord(word: string, titleCaps: boolean): string {
  const parts = word.split(SEPARATORS)
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!
    if (i % 2 === 1) { out += part; continue }
    if (i === 0) { out += fixSegment(part, titleCaps); continue }
    const sep = parts[i - 1]!
    const prev = letterCount(parts[i - 2]!)
    const startsWord = sep === '-' || (sep === '.' && prev <= 2) || ((sep === "'" || sep === '’') && prev === 1)
    out += startsWord ? fixSegment(part, titleCaps) : part
  }
  return out
}

export function cleanPersonName(input: string): string {
  let s = input.normalize('NFC')
  s = s.replace(CONTROL_CHAR, ' ')                                          // tabs, newlines, other controls
  s = s.replace(FORMAT_CHAR, (ch) => (JOINERS.includes(ch) ? ch : ''))      // invisible noise, except joiners
  s = s.replace(/[\p{Z}\s]+/gu, ' ').trim()
  s = s.replace(WORD_EDGE_JOINERS, '').replace(/ {2,}/g, ' ').trim()       // a joiner between two spaces leaves a double space
  const shouted = hasUpper(s) && !hasLower(s)                               // the whole name typed in capitals
  s = s.split(' ').map((w) => fixWord(w, shouted)).join(' ')
  return s.normalize('NFC')
}

const charCount = (s: string) => Array.from(s).length

/** Why a cleaned name is not acceptable, or null. Messages are written for the person typing. */
export function checkPersonName(name: string, { min, max }: NameOptions): string | null {
  const n = charCount(name)
  if (n === 0) return 'Enter a name'
  if (n < min) return `Name must be at least ${min} characters`
  if (n > max) return `Name must be at most ${max} characters`
  if (letterCount(name) < Math.min(min, 2)) return 'Name must contain letters'
  if (/\p{Extended_Pictographic}/u.test(name)) return "Name can't include emoji"
  if (/[<>@]|:\/\/|\bwww\.|\d{4,}/i.test(name)) return "Name can't include links, email addresses, long numbers or symbols like < >"
  return null
}

export function normalizePersonName(raw: string, opts: NameOptions): NameResult {
  if (raw.length > MAX_RAW_LENGTH) return { ok: false, message: `Name must be at most ${opts.max} characters` }
  const name = cleanPersonName(raw)
  const problem = checkPersonName(name, opts)
  return problem ? { ok: false, message: problem } : { ok: true, name }
}

/** For write paths: the cleaned name, or a 422 with a message fit to show the person.
 *
 *  `current` is the name already on file. A client that echoes it back unchanged (a rider changing only their email, a
 *  driver resuming onboarding) must not be blocked by rules that did not exist when the name was saved, so an unchanged
 *  name is accepted and stored cleaned, whatever the content rules say. */
export function requirePersonName(raw: string, opts: NameOptions, current?: string | null): string {
  if (typeof raw !== 'string') throw httpError(422, 'Enter a name', 'VALIDATION_ERROR')
  if (current && raw.length <= MAX_RAW_LENGTH) {
    const cleaned = cleanPersonName(raw)
    if (cleaned.length > 0 && cleaned === cleanPersonName(current)) return cleaned
  }
  const r = normalizePersonName(raw, opts)
  if (!r.ok) throw httpError(422, r.message, 'VALIDATION_ERROR')
  return r.name
}

/** Request-shape check only: a string of sensible size that is not blank. The content rules (and the "unchanged name"
 *  allowance, which needs the stored name) live in requirePersonName, because the validate() middleware only checks a
 *  body and does not replace it, so the service is the one place that sees what is stored. */
export const personNameSchema = (opts: NameOptions) =>
  z.string().superRefine((raw, ctx) => {
    if (raw.length > MAX_RAW_LENGTH) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Name must be at most ${opts.max} characters` })
    } else if (cleanPersonName(raw).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a name' })
    }
  })
