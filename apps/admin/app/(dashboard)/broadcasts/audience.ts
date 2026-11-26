import type { BroadcastAudience, BroadcastAudienceShown } from '@/lib/broadcast-api'

// Pure helpers for the Broadcasts page: turn the form into the audience the API takes, and an audience into words.

export type AudienceForm = {
  role: 'driver' | 'rider'
  cityIds: string[]
  categoryIds: string[]
  docIssues: boolean
  missingRcBack: boolean
  /** Drivers who stopped partway through verification. Used alone: they have no city or vehicle yet. */
  incompleteKyc: boolean
  /** '' = any rider. */
  bookedInLastDays: '' | '7' | '30' | '90'
  /** Specific people, one per line or separated by commas/spaces. Used alone: it replaces every other filter. */
  phonesText: string
  usePhones: boolean
}

export const EMPTY_FORM: AudienceForm = {
  role: 'driver', cityIds: [], categoryIds: [], docIssues: false, missingRcBack: false, incompleteKyc: false, bookedInLastDays: '', phonesText: '', usePhones: false,
}

/** '98610 03979', '9861003979', '+919861003979' and '919861003979' all become '+919861003979'; anything else is null. (Same rule as the API.) */
export function normalizeIndianPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  const e164 = digits.length === 10 ? `+91${digits}` : digits.length === 12 && digits.startsWith('91') ? `+${digits}` : null
  return e164 !== null && /^\+91[6-9]\d{9}$/.test(e164) ? e164 : null
}

/** Splits what was typed on commas, semicolons and line breaks (a number may contain spaces), and sorts it into valid and invalid. */
export function parsePhones(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = []
  const invalid: string[] = []
  for (const part of text.split(/[\n,;]+/).map((p) => p.trim()).filter(Boolean)) {
    const n = normalizeIndianPhone(part)
    if (n === null) invalid.push(part)
    else if (!valid.includes(n)) valid.push(n)
  }
  return { valid, invalid }
}

export const MAX_PHONES = 10

export function buildAudience(form: AudienceForm): BroadcastAudience {
  if (form.usePhones) return { role: form.role, phones: parsePhones(form.phonesText).valid }
  if (form.role === 'driver' && form.incompleteKyc) return { role: 'driver', incompleteKyc: true }
  const a: BroadcastAudience = { role: form.role }
  if (form.role === 'driver') {
    if (form.cityIds.length) a.cityIds = form.cityIds.map(Number)
    if (form.categoryIds.length) a.categoryIds = form.categoryIds.map(Number)
    if (form.docIssues) a.docIssues = true
    if (form.missingRcBack) a.missingRcBack = true
  } else if (form.bookedInLastDays) {
    a.bookedInLastDays = Number(form.bookedInLastDays)
  }
  return a
}

/** True when the form describes an audience that can be checked: phone mode needs at least one valid number and no more than the limit. */
export function audienceReady(form: AudienceForm): boolean {
  if (!form.usePhones) return true
  const { valid, invalid } = parsePhones(form.phonesText)
  return valid.length >= 1 && valid.length <= MAX_PHONES && invalid.length === 0
}

type Names = { cities: ReadonlyMap<number, string>; categories: ReadonlyMap<number, string> }

/** "Drivers · Cuttack, Puri · SUV · blocked by documents" / "Riders · booked in the last 30 days" / "2 phone numbers (drivers)". */
export function describeAudience(a: BroadcastAudienceShown, names: Names): string {
  const who = a.role === 'driver' ? 'Drivers' : 'Riders'
  if (a.phoneCount) return `${a.phoneCount} phone number${a.phoneCount === 1 ? '' : 's'} (${who.toLowerCase()})`
  const parts: string[] = [a.role === 'driver' && !hasDriverFilter(a) ? 'All drivers' : a.role === 'rider' && !a.bookedInLastDays ? 'All riders' : who]
  if (a.cityIds?.length) parts.push(a.cityIds.map((id) => names.cities.get(id) ?? `City ${id}`).join(', '))
  if (a.categoryIds?.length) parts.push(a.categoryIds.map((id) => names.categories.get(id) ?? `Type ${id}`).join(', '))
  if (a.incompleteKyc) parts.push('not finished verification')
  if (a.docIssues) parts.push('blocked by documents')
  if (a.missingRcBack) parts.push('missing the RC back')
  if (a.bookedInLastDays) parts.push(`booked in the last ${a.bookedInLastDays} days`)
  return parts.join(' · ')
}

function hasDriverFilter(a: BroadcastAudienceShown): boolean {
  return !!(a.cityIds?.length || a.categoryIds?.length || a.docIssues || a.missingRcBack || a.incompleteKyc)
}
