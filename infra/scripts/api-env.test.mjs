// node --test infra/scripts/api-env.test.mjs   (pure helpers only; nothing here touches AWS)
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEnv, diffEnv, describeDiff, show } from './api-env.mjs'

test('parseEnv keeps values verbatim, skips comments and blanks', () => {
  const m = parseEnv('# comment\n\nA=1\nB=x=y z\nC="quoted"\r\nD=\n')
  assert.deepEqual([...m], [['A', '1'], ['B', 'x=y z'], ['C', '"quoted"'], ['D', '']])
})

test('parseEnv rejects a bad line, a bad key and a duplicate, naming the line', () => {
  assert.throws(() => parseEnv('A=1\nnonsense'), /line 2/)
  assert.throws(() => parseEnv('1BAD=x'), /line 1/)
  assert.throws(() => parseEnv('=x'), /line 1/)
  assert.throws(() => parseEnv('A=1\nB=2\nA=3'), /line 3: A appears twice/)
})

test('diffEnv finds added, removed and changed keys', () => {
  const d = diffEnv(parseEnv('A=1\nB=2\nC=3'), parseEnv('A=1\nB=9\nD=4'))
  assert.deepEqual(d, { added: ['D'], removed: ['C'], changed: ['B'], any: true })
  assert.equal(diffEnv(parseEnv('A=1'), parseEnv('# only a comment\nA=1')).any, false)
})

test('values are masked unless asked for', () => {
  assert.equal(show('supersecretvalue'), 'su... (16 chars)')
  assert.equal(show(''), '(empty)')
  const out = describeDiff(parseEnv('K=oldvalue1'), parseEnv('K=newvalue22')).join('\n')
  assert.ok(!out.includes('oldvalue1') && !out.includes('newvalue22'))
  assert.ok(describeDiff(parseEnv('K=oldvalue1'), parseEnv('K=newvalue22'), true).join('\n').includes('newvalue22'))
})
