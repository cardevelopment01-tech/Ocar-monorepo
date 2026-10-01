/** @type {import('next').NextConfig} */
const config = {
  // workspace package shipped as TypeScript source (no build step)
  transpilePackages: ['@ocar/shared'],
}

export default config
