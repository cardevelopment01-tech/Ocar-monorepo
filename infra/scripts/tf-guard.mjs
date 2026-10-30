#!/usr/bin/env node
// Preflight guard for Terraform runs in infra/terraform. prd (production) and stg (staging) share one directory and one code base:
// running one environment's tfvars while .terraform/ points at another's state would plan to replace that environment's resources.
//
//   node infra/scripts/tf-guard.mjs <prd|stg> <check|init|plan|apply|destroy>
//
// check    verify only (backend key, tfvars, AWS identity); changes nothing
// init     terraform init -reconfigure against <env>.backend.hcl, in that environment's own data dir
// plan     guard, then plan; saves <env>.tfplan
// apply    only a plan file this guard produced
// destroy  stg only (staging is disposable): shows the full destroy plan, then asks you to type "destroy stg"
//
// Data dirs: prd -> .terraform-prd, stg -> .terraform-stg. The guard sets TF_DATA_DIR itself, so there
// is nothing to remember. Extra terraform args after `--` are passed through to plan.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'

const TF_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'terraform')
const STATE_BUCKET = 'ocar-terraform-state'
const ENVS = {
  prd: { dataDir: '.terraform-prd', backend: 'prd.backend.hcl', key: 'prd/terraform.tfstate', tfvars: 'prd.tfvars' },
  stg: { dataDir: '.terraform-stg', backend: 'stg.backend.hcl', key: 'stg/terraform.tfstate', tfvars: 'stg.tfvars' },
}

const fail = (msg) => {
  console.error(`\nGUARD FAILED: ${msg}\n`)
  process.exit(1)
}
const ok = (msg) => console.log(`  ok  ${msg}`)

const [envName, cmd, ...rest] = process.argv.slice(2)
const env = ENVS[envName]
if (!env || !['check', 'init', 'plan', 'apply', 'destroy'].includes(cmd)) {
  fail('usage: tf-guard.mjs <prd|stg> <check|init|plan|apply|destroy> [-- extra terraform args]')
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

  if (env.tfvars) {
    const tfvars = join(TF_DIR, env.tfvars)
    if (!existsSync(tfvars)) fail(`${env.tfvars} is missing (it is gitignored -- restore it before planning)`)
    if (!new RegExp(`^\\s*environment\\s*=\\s*"${envName}"\\s*$`, 'm').test(readFileSync(tfvars, 'utf8'))) {
      fail(`${env.tfvars} does not set environment = "${envName}"`)
    }
    ok(`${env.tfvars} sets environment = "${envName}"`)
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
// A plan that deletes something is refused unless EVERY deleted address is named in GUARD_ALLOW_DELETE
// (comma-separated, exact Terraform addresses). Anything else in the plan that deletes still fails the check, and a
// database, load balancer, bucket or key can never be allow-listed: removing a subnet is the only intended use.
const NEVER_DELETE = /^(aws_db_instance|aws_lb\.|aws_elasticache_replication_group|aws_s3_bucket\.|aws_kms_key|aws_vpc)/
function checkPlanFile(planFile) {
  const show = run(['show', '-json', planFile], { capture: true })
  if (show.status !== 0) fail(`terraform show failed for ${planFile}`)
  const plan = JSON.parse(show.stdout)
  const planEnv = plan.variables?.environment?.value
  if (planEnv !== envName) fail(`${planFile} was planned with environment="${planEnv}", expected "${envName}"`)
  ok(`${planFile} was planned with environment="${envName}"`)

  const changes = (plan.resource_changes ?? []).filter((c) => !c.change.actions.every((a) => a === 'no-op'))
  const destructive = changes.filter((c) => c.change.actions.includes('delete'))
  const allowed = new Set((process.env.GUARD_ALLOW_DELETE || '').split(',').map((s) => s.trim()).filter(Boolean))
  const refused = destructive.filter((c) => !allowed.has(c.address) || NEVER_DELETE.test(c.address))
  if (refused.length) {
    fail(`plan deletes/replaces: ${refused.map((c) => c.address).join(', ')} (refused; to allow an exact address set GUARD_ALLOW_DELETE, never for databases, load balancers, caches, buckets, keys or the VPC)`)
  }
  const touchesProd = changes.filter((c) => c.change.before && JSON.stringify(c.change.before).includes('ocar-prod'))
  if (touchesProd.length) fail(`plan modifies existing objects that mention ocar-prod: ${touchesProd.map((c) => c.address).join(', ')}`)
  ok(`${changes.length} resource change(s); ${destructive.length ? 'deletes only the allow-listed ' + destructive.map((c) => c.address).join(', ') : 'none delete anything'}; none touch ocar-prod-*`)
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

if (cmd === 'destroy' && envName !== 'stg') {
  fail('destroy is wired for stg only. prd is production and is protected; destroying it needs an explicit, separate decision.')
}

checkBackend()
if (cmd === 'check') process.exit(0)

if (cmd === 'plan') {
  const args = ['plan', `-var-file=${env.tfvars}`, `-out=${envName}.tfplan`, '-input=false']
  const r = run([...args, ...extra])
  process.exit(r.status ?? 1)
}

if (cmd === 'destroy') {
  if (envName !== 'stg') {
    fail('destroy is wired for stg only. prod and prd are protected; destroying them needs an explicit, separate decision.')
  }
  console.log('\nEverything `destroy` would remove from stg:\n')
  const preview = run(['plan', '-destroy', `-var-file=${env.tfvars}`, '-input=false'])
  if (preview.status !== 0) fail('terraform plan -destroy failed, nothing was destroyed')
  await confirm('destroy stg')
  process.exit(run(['destroy', `-var-file=${env.tfvars}`, '-input=false', '-auto-approve']).status ?? 1)
}

// apply
const planFile = `${envName}.tfplan`
if (!existsSync(join(TF_DIR, planFile))) fail(`${planFile} not found -- run the plan step first`)
checkPlanFile(planFile)
await confirm(`apply ${envName}`)
process.exit(run(['apply', planFile]).status ?? 1)
