import { describe, it, expect } from 'vitest'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

// Value: protects=the home page's Largest Contentful Paint (the header logo was a 213 KB PNG, 4.3 s LCP on throttled mobile);
// fails_when=a heavy image is put back for the logo or the favicon; why_new=measured with Lighthouse on the live site; seam=none
// (file sizes); no_claim=the LCP number itself (re-measure after a deploy).
const kb = (p: string) => statSync(resolve(__dirname, '..', p)).size / 1024
describe('logo weight', () => {
  it('keeps the logo and favicon light', () => {
    expect(kb('public/logo-mark-sm.webp')).toBeLessThan(30) // the header / footer logo
    expect(kb('public/logo-mark.webp')).toBeLessThan(80) // splash and login
    expect(kb('app/icon.png')).toBeLessThan(40)
  })
})
