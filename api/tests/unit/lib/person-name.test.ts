import { describe, it, expect } from 'vitest'
import { cleanPersonName, checkPersonName, normalizePersonName, requirePersonName, personNameSchema } from '@/lib/person-name'

const DRIVER = { min: 2, max: 120 }
const ZWJ = '‍'
const ZWNJ = '‌'

describe('cleanPersonName: capitals', () => {
  it.each([
    ['sujal kumar sahoo', 'Sujal Kumar Sahoo'],
    ['SUJAL KUMAR SAHOO', 'Sujal Kumar Sahoo'],
    ['sujal KUMAR sahoo', 'Sujal KUMAR Sahoo'], // mixed: only the lower-case words change, deliberate capitals stay
    ['abdul-rahman khan', 'Abdul-Rahman Khan'],
    ['ABDUL-RAHMAN', 'Abdul-Rahman'],
    ["d'souza", "D'Souza"],
    ['o’brien', 'O’Brien'],
    ['b.k.sahoo', 'B.K.Sahoo'],
    ['dr. a p j abdul kalam', 'Dr. A P J Abdul Kalam'],
  ])('%s -> %s', (input, expected) => {
    expect(cleanPersonName(input)).toBe(expected)
  })

  it.each([
    'McDonald', 'DeSouza', 'SK Das', 'MD Rafi', 'B. K. Sahoo', 'Sujal Kumar Sahoo', "D'Souza", 'Abdul-Rahman',
    'ସୁଜଲ କୁମାର ସାହୁ', // Odia: no letter case, must pass through untouched
    'सुजल कुमार साहू',  // Devanagari
    'José Álvarez', 'Zoë Müller',
  ])('leaves a well-formed name unchanged: %s', (name) => {
    expect(cleanPersonName(name)).toBe(name)
  })

  it('a name typed ENTIRELY in capitals is title-cased, but two-letter parts stay (initials, prefixes)', () => {
    expect(cleanPersonName('SK DAS')).toBe('SK Das')
    expect(cleanPersonName('KR SAHOO')).toBe('KR Sahoo')
  })

  it('does not touch capital initials or numerals inside a name that is otherwise mixed-case', () => {
    for (const name of ['KRS Naidu', 'MBA Das', 'KVS Rao', 'Ravi Kumar III', 'John Smith IV', 'A P J Abdul Kalam']) {
      expect(cleanPersonName(name)).toBe(name)
    }
  })

  it("apostrophes and dots only start a capital where a name does: D'Souza, O'Brien, B.K., not Dad's", () => {
    expect(cleanPersonName("dad's office")).toBe("Dad's Office")
    expect(cleanPersonName("Dad's")).toBe("Dad's")
    expect(cleanPersonName("ma'am")).toBe("Ma'am")
    expect(cleanPersonName("o'brien")).toBe("O'Brien")
    expect(cleanPersonName("l'oreal")).toBe("L'Oreal")
    expect(cleanPersonName('Sujal K.sahoo')).toBe('Sujal K.Sahoo')
  })
})

describe('cleanPersonName: whitespace and invisible characters', () => {
  it('trims, collapses runs of spaces and turns tabs, newlines and no-break spaces into one space', () => {
    expect(cleanPersonName('  Sujal   Kumar\t\nSahoo ')).toBe('Sujal Kumar Sahoo')
    expect(cleanPersonName('Sujal Kumar Sahoo')).toBe('Sujal Kumar Sahoo')
  })

  it('removes zero-width spaces, BOM, soft hyphens and bidi controls', () => {
    expect(cleanPersonName('Su​jal﻿ Ku­mar')).toBe('Sujal Kumar')
    expect(cleanPersonName('‮Sujal‬ Kumar')).toBe('Sujal Kumar')
  })

  it('keeps a zero-width joiner / non-joiner inside a word but never at the edge of the name or of any word', () => {
    expect(cleanPersonName(`क्${ZWJ}ष`)).toContain(ZWJ)
    expect(cleanPersonName(`${ZWJ}Sujal${ZWNJ}`)).toBe('Sujal')
    expect(cleanPersonName(`Sujal ${ZWJ}Kumar`)).toBe('Sujal Kumar')
    expect(cleanPersonName(`Sujal${ZWNJ} Kumar`)).toBe('Sujal Kumar')
    expect(cleanPersonName(`Sujal ${ZWJ}${ZWNJ} Kumar`)).toBe('Sujal Kumar')
  })

  it('applies NFC so the same name typed two ways is stored one way', () => {
    const decomposed = 'José' // e + combining acute
    expect(cleanPersonName(decomposed)).toBe('José')
    expect(cleanPersonName(decomposed)).toBe(cleanPersonName('José'))
  })
})

describe('cleanPersonName: stable', () => {
  const samples = [
    'sujal kumar sahoo', 'SUJAL  KUMAR', "  d'souza  ", 'abdul-rahman', 'b.k.sahoo', 'McDonald', 'SK das', 'ସୁଜଲ  କୁମାର',
    'Su​jal', 'José alvarez', 'ÉCOLE', 'İSTANBUL', 'ǅemal', 'MARY-JANE O’NEIL', 'x', '',
    "dad's office", 'KRS NAIDU', `Sujal ${ZWJ}Kumar`, `Sujal ${ZWJ}${ZWNJ} Kumar`, 'k.sahoo', 'sujal KUMAR',
  ]
  it.each(samples)('cleaning twice equals cleaning once: %j', (s) => {
    const once = cleanPersonName(s)
    expect(cleanPersonName(once)).toBe(once)
  })
})

describe('checkPersonName / normalizePersonName', () => {
  it('accepts ordinary names, including a single word', () => {
    expect(normalizePersonName('sujal kumar sahoo', DRIVER)).toEqual({ ok: true, name: 'Sujal Kumar Sahoo' })
    expect(normalizePersonName('Madonna', DRIVER)).toEqual({ ok: true, name: 'Madonna' })
    expect(normalizePersonName('Li', DRIVER)).toEqual({ ok: true, name: 'Li' })
  })

  it('counts characters a person sees, not UTF-16 units', () => {
    expect(checkPersonName('𠮷野', { min: 2, max: 2 })).toBeNull()
  })

  it('rejects empty, too short and too long after cleaning', () => {
    expect(normalizePersonName('   ', DRIVER)).toEqual({ ok: false, message: 'Enter a name' })
    expect(normalizePersonName(' A ', DRIVER)).toMatchObject({ ok: false, message: 'Name must be at least 2 characters' })
    expect(normalizePersonName('a'.repeat(121), DRIVER)).toMatchObject({ ok: false, message: 'Name must be at most 120 characters' })
    expect(normalizePersonName('a'.repeat(100000), DRIVER)).toMatchObject({ ok: false }) // bounded before any regex work
    // ordinary padding around a real name is just removed, however long
    expect(normalizePersonName(' '.repeat(1500) + 'Ma' + '​'.repeat(300), { min: 1, max: 60 })).toEqual({ ok: true, name: 'Ma' })
  })

  it('a name made of padding does not sneak past the minimum', () => {
    expect(normalizePersonName('​​ ', DRIVER)).toMatchObject({ ok: false })
  })

  it('needs letters, and refuses links, emails, brackets, emoji and long numbers', () => {
    expect(normalizePersonName('-- ..', DRIVER)).toMatchObject({ ok: false, message: 'Name must contain letters' })
    expect(normalizePersonName('Sujal 🚕', DRIVER)).toMatchObject({ ok: false, message: "Name can't include emoji" })
    for (const bad of ['visit http://x.co now', 'www.cheap-rides.com', 'a@b.com', '<b>Sujal</b>', 'Call 9000000001']) {
      expect(normalizePersonName(bad, DRIVER)).toMatchObject({ ok: false })
    }
  })

  it('allows short digits and dots, which real names sometimes have', () => {
    expect(normalizePersonName('Ravi Kumar 2', DRIVER)).toMatchObject({ ok: true })
    expect(normalizePersonName('St. John', DRIVER)).toMatchObject({ ok: true })
  })

  it('a contact name can be a single character, a driver name cannot', () => {
    expect(normalizePersonName('Ma', { min: 1, max: 60 })).toMatchObject({ ok: true })
    expect(normalizePersonName('M', { min: 1, max: 60 })).toMatchObject({ ok: true })
    expect(normalizePersonName('M', DRIVER)).toMatchObject({ ok: false })
    expect(normalizePersonName('x'.repeat(61), { min: 1, max: 60 })).toMatchObject({ ok: false })
  })
})

describe('requirePersonName', () => {
  it('returns the cleaned value, or a 422 with the message', () => {
    expect(requirePersonName('  sujal   kumar ', DRIVER)).toBe('Sujal Kumar')
    expect(() => requirePersonName('<script>', DRIVER)).toThrow(/Name can't include/)
    try { requirePersonName('A', DRIVER) } catch (e) {
      expect(e).toMatchObject({ httpStatus: 422, appCode: 'VALIDATION_ERROR' })
    }
  })

  it('refuses something that is not text instead of turning it into a word', () => {
    expect(() => requirePersonName(null as unknown as string, DRIVER)).toThrow()
    expect(() => requirePersonName(123 as unknown as string, DRIVER)).toThrow()
  })

  it('accepts a name unchanged from the one on file even if the content rules would now refuse it', () => {
    const legacy = 'Ravi Kumar 🚕 9000000001'
    expect(() => requirePersonName(legacy, DRIVER)).toThrow()
    expect(requirePersonName(legacy, DRIVER, legacy)).toBe(legacy)
    expect(requirePersonName('  Ravi   Kumar 🚕 9000000001 ', DRIVER, legacy)).toBe(legacy) // still stored cleaned
  })

  it('but a CHANGED name is held to the rules, and the allowance never applies without a name on file', () => {
    expect(() => requirePersonName('Ravi Kumar 🚕 9000000002', DRIVER, 'Ravi Kumar 🚕 9000000001')).toThrow()
    expect(() => requirePersonName('Ravi 🚕', DRIVER, null)).toThrow()
    expect(() => requirePersonName('Ravi 🚕', DRIVER, '')).toThrow()
  })
})

describe('personNameSchema (request shape only)', () => {
  const schema = personNameSchema(DRIVER)
  it('accepts text of sensible size', () => {
    expect(schema.safeParse('sujal kumar').success).toBe(true)
    expect(schema.safeParse('a@b.com').success).toBe(true) // content rules are the service's job, where the stored name is known
  })
  it('rejects blank, padding-only, oversized and non-text input', () => {
    expect(schema.safeParse('   ').success).toBe(false)
    expect(schema.safeParse('​​').success).toBe(false)
    expect(schema.safeParse('a'.repeat(3000)).success).toBe(false)
    expect(schema.safeParse(42 as unknown as string).success).toBe(false)
  })
})
