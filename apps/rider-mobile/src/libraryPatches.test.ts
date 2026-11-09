import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Value: protects=the app cannot ship without the react-native-maps patch that stops a missing marker from crashing it (a
// release built from a copy that dropped patches/ or pnpm.patchedDependencies would crash when a car is animated too early);
// fails_when=patches/react-native-maps@*.patch is not applied in the installed package; why_new=live nearby-cars push;
// seam=the installed package's Android source; no_claim=the Java itself (verified on a device build).
const require = createRequire(import.meta.url)

describe('react-native-maps patch', () => {
  it('is applied to the installed package (null-safe marker animation)', () => {
    const root = dirname(require.resolve('react-native-maps/package.json'))
    const java = readFileSync(join(root, 'android/src/main/java/com/rnmaps/maps/MapMarker.java'), 'utf8')
    expect(java).toContain('Ocar patch')
    expect(java).toMatch(/if \(marker == null \|\| finalPosition == null\) return;/)
  })
})
