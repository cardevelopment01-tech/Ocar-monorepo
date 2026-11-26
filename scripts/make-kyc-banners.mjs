// Renders the four onboarding-reminder banners (0 to 3 steps done) to apps/user/public/push/kyc-step-N.png, 1024x512 (2:1), the shape Android shows
// when a push is expanded. The words are in the notification itself, so the picture carries only the progress and the step names.
// Run:  NODE_PATH=<a node_modules folder that has sharp> node scripts/make-kyc-banners.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const sharp = require('sharp')
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'user', 'public', 'push')
mkdirSync(out, { recursive: true })

const LABELS = ['Details', 'Vehicle', 'Documents', 'Selfie']
const XS = [96, 232, 368, 504]
const FONT = "font-family=\"Segoe UI, Helvetica, Arial, sans-serif\""

function svg(done) {
  const track = `<line x1="96" y1="214" x2="504" y2="214" stroke="#fff" stroke-opacity=".28" stroke-width="3" stroke-linecap="round"/>` +
    (done > 0 ? `<line x1="96" y1="214" x2="${XS[done - 1]}" y2="214" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` : '')
  let nodes = ''
  for (let i = 0; i < 4; i++) {
    const x = XS[i]
    if (i < done) nodes += `<circle cx="${x}" cy="214" r="15" fill="#fff"/><path d="M${x - 6} 214 l4.5 4.5 l8-9" fill="none" stroke="#0A6F80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    else if (i === done) nodes += `<circle cx="${x}" cy="214" r="21" fill="#fff" fill-opacity=".18"/><circle cx="${x}" cy="214" r="15" fill="#fff"/><circle cx="${x}" cy="214" r="5.5" fill="#0E8FA3"/>`
    else nodes += `<circle cx="${x}" cy="214" r="14" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2.5"/>`
    nodes += `<text x="${x}" y="262" text-anchor="middle" ${FONT} font-size="15" font-weight="${i === done ? 700 : 500}" fill="#fff" fill-opacity="${i <= done ? 1 : 0.7}">${LABELS[i]}</text>`
  }
  const big = done === 0 ? '4 steps' : `${done} of 4`
  const small = done === 0 ? 'About 10 minutes' : 'steps done'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="512" viewBox="0 0 640 320">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0A6F80"/><stop offset="1" stop-color="#14A0B5"/></linearGradient></defs>
    <rect width="640" height="320" fill="url(#g)"/>
    <circle cx="590" cy="30" r="150" fill="#fff" fill-opacity=".06"/><circle cx="640" cy="120" r="90" fill="#fff" fill-opacity=".06"/>
    <text x="40" y="100" ${FONT} font-size="54" font-weight="700" fill="#fff" letter-spacing="-1">${big}</text>
    <text x="42" y="134" ${FONT} font-size="18" fill="#fff" fill-opacity=".85">${small}</text>
    ${track}${nodes}</svg>`
}

for (let done = 0; done <= 3; done++) {
  const file = path.join(out, `kyc-step-${done}.png`)
  writeFileSync(file, await sharp(Buffer.from(svg(done))).png().toBuffer())
  console.log('wrote', path.relative(process.cwd(), file))
}
