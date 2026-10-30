#!/usr/bin/env node
// Pull, edit and push an environment's API settings -- the SSM SecureString /ocar/<env>/api-env -- with a diff and a
// confirmation, so changing one key no longer means hand-editing and re-uploading a blob.
//
//   node infra/scripts/api-env.mjs <command> <prd|stg> [file] [--show-values] [--dry-run] [--force]
//
// pull     write the live value to a local file (default .api-env.<env>, gitignored). Refuses to overwrite one without --force
// edit     pull to a temp file, open $VISUAL / $EDITOR, show what changed, ask, then push. The temp file is always removed
// push     <file> push a local file after showing the diff against live and asking
// diff     <file> show how a local file differs from live (changes nothing)
// history  every stored version of the parameter: when, who, and which keys changed
//
// Values are NEVER printed unless you pass --show-values: a changed key shows as "ab... (24 chars) -> cd... (31 chars)".
// A push is refused if someone changed the parameter after you read it (version check), if the file does not parse, or if
// it would drop more than half of the live keys (unless --force). It keeps the parameter's tier and KMS key.
// Writes need you to type "push <env>".

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import readline from 'node:readline/promises'

export const ENVS = ['prd', 'stg']
const REGION = 'ap-south-1'
// API_ENV_PREFIX exists so the write path can be tested against a throwaway parameter, never against prd.
const paramName = (env) => `${process.env.API_ENV_PREFIX || '/ocar'}/${env}/api-env`

// ---- pure helpers (covered by api-env.test.mjs) --------------------------------------------------------------------

// KEY=VALUE per line, blank lines and # comments allowed. The value is everything after the first "=", untouched (an
// env file read by Docker keeps quotes and spaces as written). Throws with the line number on anything else.
export function parseEnv(text) {
  const map = new Map()
  text.split(/\r?\n/).forEach((line, i) => {
    if (line.trim() === '' || line.trimStart().startsWith('#')) return
    const eq = line.indexOf('=')
    const key = eq > 0 ? line.slice(0, eq) : ''
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`line ${i + 1}: expected KEY=VALUE, got "${line.slice(0, 40)}"`)
    if (map.has(key)) throw new Error(`line ${i + 1}: ${key} appears twice`)
    map.set(key, line.slice(eq + 1))
  })
  return map
}

export function diffEnv(from, to) {
  const added = [...to.keys()].filter((k) => !from.has(k))
  const removed = [...from.keys()].filter((k) => !to.has(k))
  const changed = [...to.keys()].filter((k) => from.has(k) && from.get(k) !== to.get(k))
  return { added, removed, changed, any: added.length + removed.length + changed.length > 0 }
}

export const show = (v, full) => (full ? JSON.stringify(v) : v === '' ? '(empty)' : `${v.slice(0, 2)}... (${v.length} chars)`)

export function describeDiff(from, to, full = false) {
  const d = diffEnv(from, to)
  return [
    ...d.added.map((k) => `  + ${k}  ${show(to.get(k), full)}`),
    ...d.removed.map((k) => `  - ${k}  (was ${show(from.get(k), full)})`),
    ...d.changed.map((k) => `  ~ ${k}  ${show(from.get(k), full)} -> ${show(to.get(k), full)}`),
  ]
}

// ---- AWS ------------------------------------------------------------------------------------------------------------

const fail = (msg) => {
  console.error(`\napi-env: ${msg}\n`)
  process.exit(1)
}

function aws(args) {
  const r = spawnSync('aws', ['--region', REGION, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'aws failed').trim().split('\n').slice(-1)[0])
  return r.stdout
}

function readLive(env) {
  const p = JSON.parse(aws(['ssm', 'get-parameter', '--name', paramName(env), '--with-decryption', '--output', 'json'])).Parameter
  return { text: p.Value, version: p.Version }
}

function writeLive(env, text, expectedVersion) {
  const meta = JSON.parse(
    aws(['ssm', 'describe-parameters', '--parameter-filters', `Key=Name,Option=Equals,Values=${paramName(env)}`, '--output', 'json']),
  ).Parameters[0]
  if (!meta) throw new Error(`${paramName(env)} does not exist`)
  const now = readLive(env).version
  if (now !== expectedVersion) throw new Error(`${paramName(env)} changed while you were editing (version ${expectedVersion} -> ${now}); nothing was written. Pull again.`)
  const dir = mkdtempSync(join(tmpdir(), 'api-env-'))
  try {
    const file = join(dir, 'value')
    writeFileSync(file, text)
    const args = ['ssm', 'put-parameter', '--name', paramName(env), '--type', 'SecureString', '--overwrite', '--tier', meta.Tier || 'Standard', '--value', `file://${file.replace(/\\/g, '/')}`, '--output', 'json']
    if (meta.KeyId) args.push('--key-id', meta.KeyId)
    return JSON.parse(aws(args)).Version
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(question)
  rl.close()
  return answer.trim()
}

// ---- commands -------------------------------------------------------------------------------------------------------

function loadFile(path) {
  if (!existsSync(path)) fail(`${path} not found`)
  const text = readFileSync(path, 'utf8')
  try {
    return { text, map: parseEnv(text) }
  } catch (e) {
    fail(`${path}: ${e.message}`)
  }
}

async function confirmAndWrite(env, liveMap, nextText, nextMap, version, opts) {
  const lines = describeDiff(liveMap, nextMap, opts.showValues)
  if (!lines.length) return console.log('No changes. Nothing written.')
  console.log(`\nChanges to ${paramName(env)} (live version ${version}):\n${lines.join('\n')}\n`)
  const d = diffEnv(liveMap, nextMap)
  if (liveMap.size && d.removed.length > liveMap.size / 2 && !opts.force) {
    fail(`this would remove ${d.removed.length} of ${liveMap.size} keys. Refusing without --force (wrong file?)`)
  }
  if (opts.dryRun) return console.log('--dry-run: nothing written.')
  if ((await ask(`Type "push ${env}" to write this to AWS: `)) !== `push ${env}`) fail('confirmation did not match, nothing was written')
  try {
    console.log(`Written. ${paramName(env)} is now version ${writeLive(env, nextText, version)}. New servers pick it up at boot; running ones need a redeploy.`)
  } catch (e) {
    fail(e.message)
  }
}

function editorCommand() {
  const raw = process.env.VISUAL || process.env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi')
  const [cmd, ...args] = raw.trim().split(/\s+/)
  // "code" returns immediately unless told to wait, which would make us read the file before you edit it.
  if (/^code(\.cmd)?$/i.test(basename(cmd)) && !args.includes('--wait')) args.push('--wait')
  return { cmd, args }
}

async function edit(env, opts) {
  const live = readLive(env)
  const liveMap = parseEnv(live.text)
  const dir = mkdtempSync(join(tmpdir(), 'api-env-'))
  const file = join(dir, `${env}.api-env`)
  try {
    writeFileSync(file, live.text)
    const { cmd, args } = editorCommand()
    for (;;) {
      const r = spawnSync(cmd, [...args, file], { stdio: 'inherit', shell: process.platform === 'win32' })
      if (r.status !== 0) fail(`editor "${cmd}" exited with ${r.status}; nothing was written`)
      const text = readFileSync(file, 'utf8')
      if (text === live.text) return console.log('No changes. Nothing written.')
      try {
        return await confirmAndWrite(env, liveMap, text, parseEnv(text), live.version, opts)
      } catch (e) {
        console.error(`\n${e.message}`)
        if ((await ask('Press Enter to reopen the editor, or type "q" to quit: ')) === 'q') return console.log('Nothing written.')
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function history(env, opts) {
  const versions = JSON.parse(aws(['ssm', 'get-parameter-history', '--name', paramName(env), '--with-decryption', '--output', 'json'])).Parameters
    .sort((a, b) => a.Version - b.Version)
  let prev = new Map()
  for (const p of versions) {
    const who = (p.LastModifiedUser || '').split('/').slice(-1)[0] || 'unknown'
    console.log(`\nv${p.Version}  ${new Date(p.LastModifiedDate).toISOString().replace('T', ' ').slice(0, 19)} UTC  by ${who}`)
    let map
    try {
      map = parseEnv(p.Value)
    } catch (e) {
      console.log(`  (cannot compare: ${e.message})`)
      continue
    }
    const lines = describeDiff(prev, map, opts.showValues)
    console.log(p.Version === versions[0].Version ? `  (first stored version, ${map.size} keys)` : lines.join('\n') || '  (no key changes)')
    prev = map
  }
}

async function main() {
  const flags = process.argv.slice(2).filter((a) => a.startsWith('--'))
  const [cmd, env, file] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const opts = { showValues: flags.includes('--show-values'), dryRun: flags.includes('--dry-run'), force: flags.includes('--force') }
  if (!['pull', 'edit', 'push', 'diff', 'history'].includes(cmd) || !ENVS.includes(env)) {
    fail(`usage: api-env.mjs <pull|edit|push|diff|history> <${ENVS.join('|')}> [file] [--show-values] [--dry-run] [--force]`)
  }
  try {
    if (cmd === 'history') return history(env, opts)
    if (cmd === 'edit') return await edit(env, opts)
    if (cmd === 'pull') {
      const out = resolve(file || `.api-env.${env}`)
      if (existsSync(out) && !opts.force) fail(`${out} exists. Use --force to overwrite it`)
      const live = readLive(env)
      writeFileSync(out, live.text)
      return console.log(`Wrote ${out} (version ${live.version}, ${parseEnv(live.text).size} keys). It holds decrypted secrets: delete it when you are done.`)
    }
    if (!file) fail(`${cmd} needs a file: api-env.mjs ${cmd} ${env} <file>`)
    const live = readLive(env)
    const next = loadFile(file)
    if (cmd === 'diff') {
      const lines = describeDiff(parseEnv(live.text), next.map, opts.showValues)
      return console.log(lines.length ? `Differences (live version ${live.version} -> ${file}):\n${lines.join('\n')}` : `${file} matches live version ${live.version}.`)
    }
    await confirmAndWrite(env, parseEnv(live.text), next.text, next.map, live.version, opts)
  } catch (e) {
    fail(e.message)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main()
