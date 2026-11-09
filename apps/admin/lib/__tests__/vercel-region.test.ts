import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Value: protects=the admin's server-rendered pages (the driver profile) running in Mumbai next to the API instead of Vercel's default
// Virginia (iad1), which added an intercontinental round trip (about 0.2-0.4 s) to every click on a driver; fails_when=the region
// setting is dropped from vercel.json; why_new=measured on the live site (X-Vercel-Id bom1::iad1); seam=none (reads the file);
// no_claim=that Vercel honours it (check X-Vercel-Id after a deploy: bom1::bom1).
describe('admin vercel.json', () => {
  it('runs functions in Mumbai (bom1), the API\'s region', () => {
    const cfg = JSON.parse(readFileSync(resolve(__dirname, '../../vercel.json'), 'utf8')) as { regions?: string[]; git?: { deploymentEnabled?: boolean } }
    expect(cfg.regions).toEqual(['bom1'])
    expect(cfg.git?.deploymentEnabled).toBe(false) // deploys stay with deploy-web.yml
  })
})
