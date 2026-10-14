import { describe, it, expect, vi } from 'vitest'

vi.mock('@/config', () => ({ config: { GOOGLE_MAPS_API_KEY: 'k' } }))
vi.mock('@/lib/logger', () => ({ logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) } }))
vi.mock('@/db/redis', () => ({ client: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))

import { stripPlusCode } from '@/modules/geo/providers/google.provider'

describe('stripPlusCode', () => {
  it('drops a leading Open Location Code and the comma after it', () => {
    expect(stripPlusCode('6RQM+P33, Lingaraj Nagar, Bhubaneswar, Odisha')).toBe('Lingaraj Nagar, Bhubaneswar, Odisha')
  })
  it('handles the short and long code forms', () => {
    expect(stripPlusCode('7JQM+G9 Cuttack')).toBe('Cuttack')
    expect(stripPlusCode('7MJRW3GH+2P6, Puri')).toBe('Puri')
  })
  it('leaves a normal address alone', () => {
    expect(stripPlusCode('Kalinga Stadium, Sector 19, Cuttack')).toBe('Kalinga Stadium, Sector 19, Cuttack')
    expect(stripPlusCode('786/92, near 7th Lane, Nayapalli')).toBe('786/92, near 7th Lane, Nayapalli')
  })
  it('keeps an address that is only a code instead of returning nothing', () => {
    expect(stripPlusCode('6RQM+P33')).toBe('6RQM+P33')
  })
})
