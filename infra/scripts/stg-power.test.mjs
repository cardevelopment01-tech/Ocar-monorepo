// node --test infra/scripts/stg-power.test.mjs   (decision logic only; nothing here touches AWS)
import test from 'node:test'
import assert from 'node:assert/strict'
import { planPause, planResume, assertStgOnly, NAMES } from './stg-power.mjs'

const up = { db: 'available', active: 'green', asg: { blue: { min: 0, desired: 0 }, green: { min: 1, desired: 1 } } }
const down = { db: 'stopped', active: 'green', asg: { blue: { min: 0, desired: 0 }, green: { min: 0, desired: 0 } } }

test('pause: scales the running colour to 0 and stops the database', () => {
  assert.deepEqual(planPause(up), [{ type: 'asg', color: 'green', min: 0, desired: 0 }, { type: 'db-stop' }])
})

test('pause is idempotent and never stops a database that is not available', () => {
  assert.deepEqual(planPause(down), [])
  assert.deepEqual(planPause({ ...up, db: 'stopping' }).filter((s) => s.type === 'db-stop'), [])
  assert.deepEqual(planPause({ ...up, db: 'starting' }).filter((s) => s.type === 'db-stop'), [])
})

test('pause also catches a second colour left up after a deploy', () => {
  const both = { ...up, asg: { blue: { min: 1, desired: 2 }, green: { min: 1, desired: 1 } } }
  assert.deepEqual(planPause(both).filter((s) => s.type === 'asg').map((s) => s.color), ['blue', 'green'])
})

test('resume: database first, then ONLY the active colour comes up', () => {
  assert.deepEqual(planResume(down), [
    { type: 'db-start' },
    { type: 'db-wait-available' },
    { type: 'asg', color: 'green', min: 1, desired: 1 },
  ])
})

test('resume waits for a database that is still stopping before starting it', () => {
  assert.deepEqual(planResume({ ...down, db: 'stopping' }).slice(0, 3).map((s) => s.type), ['db-wait-stopped', 'db-start', 'db-wait-available'])
})

test('resume does not touch a database that is already starting, and is idempotent when running', () => {
  assert.deepEqual(planResume({ ...down, db: 'starting' }).map((s) => s.type), ['db-wait-available', 'asg'])
  assert.deepEqual(planResume(up), [])
})

test('resume never lowers a running or scaled-out stg, and leaves the idle colour alone', () => {
  const busy = { db: 'available', active: 'blue', asg: { blue: { min: 1, desired: 3 }, green: { min: 0, desired: 2 } } }
  assert.deepEqual(planResume(busy), [])
})

test('it can only ever touch stg names', () => {
  assert.doesNotThrow(() => assertStgOnly())
  assert.throws(() => assertStgOnly({ ...NAMES, db: 'ocar-prd-db' }), /not stg resources/)
  assert.throws(() => assertStgOnly({ ...NAMES, asg: { blue: 'ocar-prd-asg-blue', green: NAMES.asg.green } }), /ocar-prd-asg-blue/)
  assert.throws(() => assertStgOnly({ ...NAMES, activeColor: '/ocar/prd/active-color' }), /\/ocar\/stg\//)
})
