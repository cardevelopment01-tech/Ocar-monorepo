import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import sitemap from '../sitemap'
import { POLICIES } from './policies'

// Adding a policy to POLICIES must not leave a dead link in the switcher, the /legal index or the sitemap.
describe('legal policies', () => {
  it('every listed policy has a page', () => {
    for (const p of POLICIES) {
      const page = join(__dirname, p.href.replace('/legal/', ''), 'page.tsx')
      expect(existsSync(page), p.href).toBe(true)
    }
  })

  it('every listed policy is in the sitemap, along with the index', () => {
    const urls = sitemap().map((e) => new URL(e.url).pathname)
    expect(urls).toContain('/legal')
    for (const p of POLICIES) expect(urls, p.href).toContain(p.href)
  })

  it('has a unique href and a date for each policy', () => {
    expect(new Set(POLICIES.map((p) => p.href)).size).toBe(POLICIES.length)
    for (const p of POLICIES) expect(p.updated).toMatch(/^\d{1,2} [A-Z][a-z]+ \d{4}$/)
  })
})
