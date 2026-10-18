import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// The Socket.IO clients (user web, driver web, admin web, mobile apps) must retry with the same timing: the Socket.IO
// defaults (1 s, +/-50%) bring every client of a lost server back inside one second. The values come from a simulation
// of 5,000 clients (see the comment in each file). There is no shared package between the web apps and the mobile apps,
// so this test is what stops the copies from drifting apart, and what notices a new client that would use the defaults.
const CLIENTS = [
  'apps/admin/lib/socket.ts',
  'apps/driver/src/lib/socket.ts',
  'apps/user/lib/socket.ts',
  'packages/mobile-shared/src/socket/createSocket.ts',
]
const REPO_ROOT = resolve(__dirname, '../../../..')

describe('socket client reconnect timing', () => {
  it.each(CLIENTS)('%s uses the agreed retry timing', (file) => {
    const src = readFileSync(resolve(REPO_ROOT, file), 'utf8')
    expect(src).toMatch(/reconnectionDelay:\s*2500,/)
    expect(src).toMatch(/reconnectionDelayMax:\s*15000,/)
    expect(src).toMatch(/randomizationFactor:\s*1,/)
  })

  it('no other file creates a socket.io client (it would fall back to the defaults)', () => {
    const files = execSync('git ls-files apps packages', { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
      .split('\n')
      .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.|\.spec\.|__tests__|node_modules/.test(f))
    const creators = files.filter((f) => /from ['"]socket\.io-client['"]/.test(readFileSync(resolve(REPO_ROOT, f), 'utf8')) && /\bio\(/.test(readFileSync(resolve(REPO_ROOT, f), 'utf8')))
    expect(creators.sort()).toEqual([...CLIENTS].sort())
  })
})
