/** @type {import('next').NextConfig} */
const config = {
  // workspace package shipped as TypeScript source (no build step)
  transpilePackages: ['@ocar/shared'],
  // Public-folder files are served with max-age=0 by default, so a returning visitor rechecked the logo every time.
  async headers() {
    const cache = [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' }]
    return [
      { source: '/logo-mark.webp', headers: cache },
      { source: '/logo-mark-sm.webp', headers: cache },
    ]
  },
}

export default config
