#!/usr/bin/env node
// Preflight guard for Terraform runs in infra/terraform. Exists because prod (the live stack) and prd (the new
// production) share one directory and one code base: running prd's tfvars while .terraform/ still points at prod's
// state would plan to replace prod's resources with prd-named ones.
//
//   node infra/scripts/tf-guard.mjs <prod|prd> <check|init|plan|apply>
//
// check  verify only (backend key, tfvars, AWS identity); changes nothing
// init   terraform init -reconfigure against <env>.backend.hcl, in that environment's own data dir
// plan   guard, then plan. prod: read-only (-lock=false, no plan file). prd: saves prd.tfplan
// apply  prd only, and only a plan file this guard produced; prod apply is refused outright
//
// Data dirs: prod -> .terraform (unchanged), prd -> .terraform-prd. The guard sets TF_DATA_DIR itself, so there
// is nothing to remember. Extra terraform args after `--` are passed through to plan.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'

const TF_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'terraform')
const STATE_BUCKET = 'ocar-terraform-state'
const ENVS = {
  prod: { dataDir: '.terraform', backend: 'prod.backend.hcl', key: 'prod/terraform.tfstate', tfvars: null },
  prd: { dataDir: '.terraform-prd', backend: 'prd.backend.hcl', key: 'prd/terraform.tfstate', tfvars: 'prd.tfvars' },
}

const fail = (msg) => {
  console.error(`\nGUARD FAILED: ${msg}\n`)
  process.exit(1)
}
const ok = (msg) => console.log(`  ok  ${msg}`)

const [envName, cmd, ...rest] = process.argv.slice(2)
const env = ENVS[envName]
if (!env || !['check', 'init', 'plan', 'apply'].includes(cmd)) {
  fail('usage: tf-guard.mjs <prod|prd> <check|init|plan|apply> [-- extra terraform args]')
}
const extra = rest[0] === '--' ? rest.slice(1) : []
// Test-only override: it is still validated below, so pointing prd at prod's data dir just makes the guard fail.
const dirFlag = rest.indexOf('--data-dir')
const dataDir = dirFlag >= 0 ? rest[dirFlag + 1] : env.dataDir

const run = (args, opts = {}) =>
  spawnSync('terraform', args, {
    cwd: TF_DIR,
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, TF_DATA_DIR: dataDir, TF_IN_AUTOMATION: '1' },
  })

function checkBackend() {
  console.log(`Preflight for ${envName} (${cmd}):`)
  const stateFile = join(TF_DIR, dataDir, 'terraform.tfstate')
  if (!existsSync(stateFile)) {
    fail(`${dataDir}/terraform.tfstate not found -- run: node infra/scripts/tf-guard.mjs ${envName} init`)
  }
  const be = JSON.parse(readFileSync(stateFile, 'utf8')).backend?.config ?? {}
  if (be.key !== env.key) fail(`${dataDir} is initialised against state key "${be.key}", expected "${env.key}"`)
  if (be.bucket !== STATE_BUCKET) fail(`${dataDir} uses bucket "${be.bucket}", expected "${STATE_BUCKET}"`)
  ok(`${dataDir} -> s3://${STATE_BUCKET}/${env.key}`)

  const hcl = readFileSync(join(TF_DIR, env.backend), 'utf8')
  if (!hcl.includes(`"${env.key}"`)) fail(`${env.backend} does not set key = "${env.key}"`)
  ok(`${env.backend} sets the same key`)

  if (envName === 'prd') {
    const tfvars = join(TF_DIR, env.tfvars)
    if (!existsSync(tfvars)) fail(`${env.tfvars} is missing (it is gitignored -- restore it before planning)`)
    if (!/^\s*environment\s*=\s*"prd"\s*$/m.test(readFileSync(tfvars, 'utf8'))) {
      fail(`${env.tfvars} does not set environment = "prd"`)
    }
    ok(`${env.tfvars} sets environment = "prd"`)
  }

  const who = spawnSync('aws', ['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (who.status !== 0) fail('AWS credentials are not working (aws sts get-caller-identity failed)')
  ok(`AWS account ${who.stdout.trim()}`)
}

// Everything in a prd plan must be about prd. A resource that already exists (non-null "before") and mentions an
// ocar-prod-* name means this plan is touching prod. Creating things is fine, and snapshot_identifier legitimately
// names a prod snapshot, so only "before" is scanned.
function checkPlanFile(planFile, { allowDelete }) {
  const show = run(['show', '-json', planFile], { capture: true })
  if (show.status !== 0) fail(`terraform show failed for ${planFile}`)
  const plan = JSON.parse(show.stdout)
  const planEnv = plan.variables?.environment?.value
  if (planEnv !== envName) fail(`${planFile} was planned with environment="${planEnv}", expected "${envName}"`)
  ok(`${planFile} was planned with environment="${envName}"`)

  const changes = (plan.resource_changes ?? []).filter((c) => !c.change.actions.every((a) => a === 'no-op'))
  const destructive = changes.filter((c) => c.change.actions.includes('delete'))
  if (destructive.length && !allowDelete) {
    fail(`plan deletes/replaces: ${destructive.map((c) => c.address).join(', ')} (refused; review by hand)`)
  }
  const touchesProd = changes.filter((c) => c.change.before && JSON.stringify(c.change.before).includes('ocar-prod'))
  if (touchesProd.length) fail(`plan modifies existing objects that mention ocar-prod: ${touchesProd.map((c) => c.address).join(', ')}`)
  ok(`${changes.length} resource change(s); none delete anything, none touch ocar-prod-*`)
}

async function confirm(phrase) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(`Type "${phrase}" to continue: `)
  rl.close()
  if (answer.trim() !== phrase) fail('confirmation did not match, nothing was applied')
}

if (cmd === 'init') {
  const r = run(['init', '-reconfigure', `-backend-config=${env.backend}`, '-input=false'])
  process.exit(r.status ?? 1)
}

checkBackend()
if (cmd === 'check') process.exit(0)

if (cmd === 'plan') {
  const args =
    envName === 'prd'
      ? ['plan', `-var-file=${env.tfvars}`, '-out=prd.tfplan', '-input=false']
      : ['plan', '-var=environment=prod', '-lock=false', '-input=false']
  const r = run([...args, ...extra])
  process.exit(r.status ?? 1)
}

// apply
if (envName !== 'prd') {
  fail('applying to prod is refused by this guard. prod is the live stack; changes to it need an explicit, separate decision.')
}
if (!existsSync(join(TF_DIR, 'prd.tfplan'))) fail('prd.tfplan not found -- run the plan step first')
checkPlanFile('prd.tfplan', { allowDelete: false })
await confirm('apply prd')
process.exit(run(['apply', 'prd.tfplan']).status ?? 1)
