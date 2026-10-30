#!/usr/bin/env node
// Pause and resume the stg (staging) environment to save money. It only ever touches resources named ocar-stg-*.
//
//   node infra/scripts/stg-power.mjs <status|pause|resume> [--wait] [--dry-run]
//
// status   what is running now (servers, database, active colour)
// pause    both ASGs to 0 servers, then stop the database (Single-AZ RDS can be stopped; AWS restarts it itself after 7
//          days, so a long pause needs another `pause`). The cache node and the load balancer cannot be paused and keep billing.
// resume   start the database and wait until it is available, then put 1 server on the ACTIVE colour (the other stays at 0)
// --wait   resume only: also wait until the load balancer reports a healthy server
// --dry-run print what would be done and change nothing
//
// Terraform ignores min_size / desired_capacity on the ASGs (asg.tf ignore_changes), so it does not fight this.
// Run by hand or by .github/workflows/stg-power.yml (nightly pause, morning resume).

import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const REGION = 'ap-south-1'
export const NAMES = {
  asg: { blue: 'ocar-stg-asg-blue', green: 'ocar-stg-asg-green' },
  db: 'ocar-stg-db',
  activeColor: '/ocar/stg/active-color',
  targetGroup: { blue: 'ocar-stg-api-tg-blue', green: 'ocar-stg-api-tg-green' },
}

// ---- pure decisions (covered by stg-power.test.mjs) ---------------------------------------------------------------

// state = { db: 'available' | 'stopped' | ..., asg: { blue: { min, desired }, green: { min, desired } }, active: 'blue' | 'green' }
export function planPause(state) {
  const steps = []
  for (const color of ['blue', 'green']) {
    const g = state.asg[color]
    if (g.min !== 0 || g.desired !== 0) steps.push({ type: 'asg', color, min: 0, desired: 0 })
  }
  if (state.db === 'available') steps.push({ type: 'db-stop' })
  return steps
}

export function planResume(state) {
  const steps = []
  if (state.db === 'stopping') steps.push({ type: 'db-wait-stopped' })
  if (['stopping', 'stopped'].includes(state.db)) steps.push({ type: 'db-start' })
  if (state.db !== 'available') steps.push({ type: 'db-wait-available' })
  // Only ever raise. A running (or scaled-out, or mid-deploy) stg must not be scaled down by a resume; after a pause both
  // colours are at 0, so bringing the active one to 1 is all that is needed.
  const active = state.asg[state.active]
  if (active.desired < 1) steps.push({ type: 'asg', color: state.active, min: 1, desired: 1 })
  return steps
}

// Every name this script can touch must be a stg name; anything else aborts before AWS is called.
export function assertStgOnly(names = NAMES) {
  const all = [names.asg.blue, names.asg.green, names.db, names.targetGroup.blue, names.targetGroup.green]
  const bad = all.filter((n) => !n.startsWith('ocar-stg-'))
  if (bad.length) throw new Error(`refusing to run: not stg resources: ${bad.join(', ')}`)
  if (!names.activeColor.startsWith('/ocar/stg/')) throw new Error('refusing to run: parameter is not under /ocar/stg/')
}

// ---- AWS ----------------------------------------------------------------------------------------------------------

function aws(args) {
  const r = spawnSync('aws', ['--region', REGION, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === 'win32',
    env: { ...process.env, MSYS_NO_PATHCONV: '1' },
  })
  if (r.status !== 0) throw new Error((r.stderr || r.stdout || 'aws failed').trim().split('\n').slice(-1)[0])
  return r.stdout.trim()
}

export function readState() {
  const groups = JSON.parse(aws(['autoscaling', 'describe-auto-scaling-groups', '--auto-scaling-group-names', NAMES.asg.blue, NAMES.asg.green, '--output', 'json'])).AutoScalingGroups
  const asg = {}
  for (const color of ['blue', 'green']) {
    const g = groups.find((x) => x.AutoScalingGroupName === NAMES.asg[color])
    if (!g) throw new Error(`${NAMES.asg[color]} not found`)
    asg[color] = { min: g.MinSize, desired: g.DesiredCapacity, running: g.Instances.filter((i) => i.LifecycleState === 'InService').length }
  }
  const db = aws(['rds', 'describe-db-instances', '--db-instance-identifier', NAMES.db, '--query', 'DBInstances[0].DBInstanceStatus', '--output', 'text'])
  const active = aws(['ssm', 'get-parameter', '--name', NAMES.activeColor, '--query', 'Parameter.Value', '--output', 'text'])
  if (!['blue', 'green'].includes(active)) throw new Error(`unexpected active colour "${active}"`)
  return { db, asg, active }
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

function waitFor(label, check, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (check()) return
    sleep(20000)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const dbStatus = () => aws(['rds', 'describe-db-instances', '--db-instance-identifier', NAMES.db, '--query', 'DBInstances[0].DBInstanceStatus', '--output', 'text'])

function run(step, dry) {
  const text = {
    asg: `${NAMES.asg[step.color]}: min ${step.min}, desired ${step.desired}`,
    'db-stop': `stop database ${NAMES.db}`,
    'db-start': `start database ${NAMES.db}`,
    'db-wait-stopped': `wait until ${NAMES.db} is stopped`,
    'db-wait-available': `wait until ${NAMES.db} is available`,
  }[step.type]
  console.log(`${dry ? '[dry-run] would: ' : '-> '}${text}`)
  if (dry) return
  if (step.type === 'asg') aws(['autoscaling', 'update-auto-scaling-group', '--auto-scaling-group-name', NAMES.asg[step.color], '--min-size', String(step.min), '--desired-capacity', String(step.desired)])
  else if (step.type === 'db-stop') aws(['rds', 'stop-db-instance', '--db-instance-identifier', NAMES.db])
  else if (step.type === 'db-start') aws(['rds', 'start-db-instance', '--db-instance-identifier', NAMES.db])
  else if (step.type === 'db-wait-stopped') waitFor('the database to stop', () => dbStatus() === 'stopped', 20 * 60 * 1000)
  else if (step.type === 'db-wait-available') waitFor('the database to become available', () => dbStatus() === 'available', 30 * 60 * 1000)
}

function describe(state) {
  const servers = ['blue', 'green'].map((c) => `${c} ${state.asg[c].running} running (min ${state.asg[c].min}, desired ${state.asg[c].desired})`).join(' | ')
  const paused = state.db !== 'available' && state.asg.blue.desired === 0 && state.asg.green.desired === 0
  const live = state.db === 'available' && state.asg[state.active].desired >= 1
  console.log(`servers: ${servers}\ndatabase: ${state.db}\nactive colour: ${state.active}\nstate: ${paused ? 'PAUSED' : live ? 'RUNNING' : 'PARTLY UP (pausing or resuming)'}`)
}

function main() {
  const args = process.argv.slice(2)
  const cmd = args.find((a) => !a.startsWith('--'))
  const flags = new Set(args.filter((a) => a.startsWith('--')))
  if (!['status', 'pause', 'resume'].includes(cmd)) {
    console.error('usage: stg-power.mjs <status|pause|resume> [--wait] [--dry-run]')
    process.exit(1)
  }
  assertStgOnly()
  const dry = flags.has('--dry-run')
  let state = readState()
  describe(state)
  if (cmd === 'status') return
  const steps = cmd === 'pause' ? planPause(state) : planResume(state)
  if (!steps.length) return console.log(`\nNothing to do: stg is already ${cmd === 'pause' ? 'paused' : 'running'}.`)
  console.log('')
  for (const s of steps) run(s, dry)
  if (dry) return
  if (cmd === 'resume' && flags.has('--wait')) {
    const tg = NAMES.targetGroup[state.active]
    console.log(`-> waiting for a healthy server behind ${tg}`)
    const arn = aws(['elbv2', 'describe-target-groups', '--names', tg, '--query', 'TargetGroups[0].TargetGroupArn', '--output', 'text'])
    waitFor('a healthy target', () => aws(['elbv2', 'describe-target-health', '--target-group-arn', arn, '--query', "length(TargetHealthDescriptions[?TargetHealth.State=='healthy'])", '--output', 'text']) !== '0', 15 * 60 * 1000)
  }
  state = readState()
  console.log('\nNow:')
  describe(state)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main()
  } catch (e) {
    console.error(`\nstg-power: ${e.message}\n`)
    process.exit(1)
  }
}
