// Playwright E2E for the Reports page. Not part of `pnpm test`.
// Needs: API on :4000 and admin on :3002 with seeded admins admin@ocar.com (super_admin) and
// ops@ocar.com (ops_admin), password Admin@1234, and `playwright` resolvable (npm i -D playwright or a scratch dir).
// Run: node apps/admin/e2e/reports.e2e.mjs
// Reports page E2E (Playwright, run with: node reports.e2e.mjs). Local dev servers on :3002 / :4000.
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = 'http://localhost:3002'
const results = []
const ok = (name, cond, extra = '') => { results.push({ name, pass: !!cond, extra }); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`) }

async function login(browser, email, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts, acceptDownloads: true })
  const page = await ctx.newPage()
  page.consoleErrors = []
  page.on('pageerror', e => page.consoleErrors.push(e.message))
  await page.goto(`${BASE}/login`)
  await page.getByPlaceholder('admin@ocar.com').fill(email)
  await page.locator('input[type=password]').fill('Admin@1234')
  await page.getByRole('button', { name: 'Sign In' }).click()
  await page.waitForURL(/overview|analytics/, { timeout: 20000 })
  return { ctx, page }
}
const open = async (page, qs = '') => {
  await page.goto(`${BASE}/analytics${qs}`)
  await page.getByRole('tablist', { name: 'Report sections' }).waitFor()
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: 'Dismiss' }).click({ timeout: 500 }).catch(() => {})
}
const url = page => new URL(page.url())

const browser = await chromium.launch()
try {
  // ── super admin ────────────────────────────────────────────────────────────
  const { ctx, page } = await login(browser, 'admin@ocar.com')
  await open(page)

  // sidebar: Snapshots removed (D12), Reports present
  ok('sidebar has Reports and no Snapshots', (await page.getByRole('link', { name: 'Reports' }).count()) > 0 && (await page.getByText('Snapshots').count()) === 0)

  // one title only (D3): no in-page h1 text visible besides sr-only, top bar shows subtitle per tab
  ok('top bar shows Reports + active tab name', await page.getByText('Overview', { exact: true }).first().isVisible())

  // tabs: click, URL, aria-selected, subtitle
  await page.getByRole('tab', { name: 'Rides & demand' }).click()
  await page.waitForTimeout(600)
  ok('tab click sets ?tab=demand', url(page).searchParams.get('tab') === 'demand')
  ok('selected tab has aria-selected', (await page.getByRole('tab', { name: 'Rides & demand' }).getAttribute('aria-selected')) === 'true')
  ok('tabpanel labelled by tab', (await page.getByRole('tabpanel').getAttribute('aria-labelledby')) === 'report-tab-demand')

  // keyboard: ArrowRight moves to Drivers and focuses it, Home goes to Overview
  await page.getByRole('tab', { name: 'Rides & demand' }).focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(500)
  ok('ArrowRight selects Drivers', url(page).searchParams.get('tab') === 'drivers')
  ok('focus follows the selected tab', await page.getByRole('tab', { name: 'Drivers' }).evaluate(el => el === document.activeElement))
  await page.keyboard.press('Home')
  await page.waitForTimeout(500)
  ok('Home selects Overview (default omitted from URL)', !url(page).searchParams.has('tab'))

  // range chips + URL
  await page.getByRole('button', { name: '7 days' }).click()
  await page.waitForTimeout(500)
  ok('7 days chip sets range=7d', url(page).searchParams.get('range') === '7d')
  ok('7 days chip is pressed', (await page.getByRole('button', { name: '7 days' }).getAttribute('aria-pressed')) === 'true')

  // custom range validation
  await page.getByRole('button', { name: 'Custom' }).click()
  await page.getByLabel('From', { exact: true }).fill('2026-09-20')
  await page.getByLabel('To', { exact: true }).fill('2026-09-10')
  await page.waitForTimeout(300)
  ok('custom from>to shows an inline message', await page.getByRole('alert').filter({ hasText: 'start date' }).isVisible())
  ok('invalid custom range is not written to the URL', url(page).searchParams.get('to') !== '2026-09-10')
  await page.getByLabel('To', { exact: true }).fill('2026-09-25')
  await page.waitForTimeout(600)
  ok('valid custom range sets range=custom&from&to', url(page).searchParams.get('range') === 'custom' && url(page).searchParams.get('from') === '2026-09-20' && url(page).searchParams.get('to') === '2026-09-25')

  // empty state with action (D4): a range with no rides
  await page.getByLabel('From', { exact: true }).fill('2020-01-01')
  await page.getByLabel('To', { exact: true }).fill('2020-01-07')
  await page.waitForTimeout(1500)
  ok('empty range shows the empty message', await page.getByText('No completed rides in this range.').isVisible())
  const act = page.getByRole('button', { name: 'Show last 90 days' })
  ok('empty state offers one action', await act.isVisible())
  await act.click()
  await page.waitForTimeout(1000)
  ok('action widens to range=90d', url(page).searchParams.get('range') === '90d')

  // city filter + clear action
  await page.getByRole('button', { name: /^City/ }).click()
  await page.getByRole('checkbox').first().click()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(800)
  ok('city filter sets ?city=', /^\d+(,\d+)*$/.test(url(page).searchParams.get('city') ?? ''))

  // compare toggle
  await page.goto(`${BASE}/analytics`); await open(page)
  await page.getByRole('switch', { name: 'Compare to previous period' }).click()
  await page.waitForTimeout(500)
  ok('compare off sets cmp=off', url(page).searchParams.get('cmp') === 'off')
  ok('no "vs previous period" text when compare is off', (await page.getByText('vs previous period').count()) === 0 && (await page.getByText('no comparison data').count()) === 0)
  await page.getByRole('switch', { name: 'Compare to previous period' }).click()

  // export (finance class): download with BOM + filename with range
  await open(page, '?from=2026-09-01&to=2026-09-29&range=custom')
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.getByRole('button', { name: 'Export CSV' }).click()])
  const path = await dl.path()
  const body = fs.readFileSync(path, 'utf8')
  ok('export downloads ocar-daily-<from>_<to>.csv', dl.suggestedFilename() === 'ocar-daily-2026-09-01_2026-09-29.csv', dl.suggestedFilename())
  ok('export starts with a UTF-8 BOM and has headers', body.startsWith('﻿Date (IST),'))
  ok('export toast appears', await page.getByText(/Downloaded ocar-daily/).isVisible())

  // finance tab content + drill-through link
  await open(page, '?tab=finance')
  ok('finance tab shows take rate and cash panel', (await page.getByText('Take rate').count()) > 0 && (await page.getByText('Flagged rides').count()) > 0)
  const href = await page.getByRole('link', { name: 'Open flagged rides' }).getAttribute('href')
  ok('cash link presets the rides filter', href === '/rides?cash=flagged', String(href))
  await page.getByRole('link', { name: 'Open flagged rides' }).click()
  await page.waitForURL(/rides/)
  await page.waitForTimeout(1500)
  ok('rides page opens with the cash filter applied', (await page.locator('select').evaluateAll(els => els.some(e => e.value === 'flagged'))) || (await page.getByText('Cash Flagged Only').count()) > 0)

  // demand tab: heatmap toggle to table (a11y alternative)
  await open(page, '?tab=demand')
  await page.getByRole('button', { name: 'View as table' }).click()
  ok('heatmap has a table alternative', await page.getByRole('columnheader', { name: 'Rides requested' }).isVisible())

  // error state: API 500 shows an error card with Retry, never zeros; retry recovers
  let failing = true
  await page.route('**/analytics/kpis*', route => (failing ? route.fulfill({ status: 500, body: '{}' }) : route.continue()))
  await open(page, '?range=90d')
  ok('500 shows an error card, not zeros', await page.getByRole('alert').filter({ hasText: 'Could not load' }).first().isVisible())
  ok('no zero KPI shown during an error', (await page.getByText('₹0').count()) === 0)
  failing = false
  await page.getByRole('button', { name: 'Retry' }).first().click()
  await page.waitForTimeout(1500)
  ok('Retry recovers the KPI band', await page.getByText('Gross bookings').first().isVisible(), (await page.getByRole('alert').allTextContents()).join('|'))
  ok('no error card remains after Retry', (await page.getByRole('alert').filter({ hasText: 'Could not load' }).count()) === 0)
  await page.unroute('**/analytics/kpis*')

  // latest wins: a slow response for an earlier filter never overwrites a newer one
  let n = 0
  await page.route('**/analytics/kpis*', async route => {
    const i = ++n
    if (i === 1) {
      await new Promise(r => setTimeout(r, 2500))
      const res = await route.fetch()
      const j = await res.json()
      j.totals.gross_bookings = 987654
      return route.fulfill({ response: res, json: j })
    }
    return route.continue()
  })
  await open(page, '?range=30d')
  await page.getByRole('button', { name: '7 days' }).click()
  await page.waitForTimeout(4200)
  ok('stale slow response is ignored (latest-wins)', (await page.getByText('₹9.9L').count()) === 0)
  await page.unroute('**/analytics/kpis*')

  ok('no uncaught page errors (finance session)', page.consoleErrors.length === 0, page.consoleErrors.join(' | '))
  await ctx.close()

  // ── reduced motion: renders, no errors ─────────────────────────────────────
  {
    const { ctx: c2, page: p2 } = await login(browser, 'admin@ocar.com', { reducedMotion: 'reduce' })
    await open(p2)
    await p2.getByRole('tab', { name: 'Drivers' }).click()
    await p2.waitForTimeout(500)
    ok('reduced motion: tabs still switch', url(p2).searchParams.get('tab') === 'drivers')
    ok('reduced motion: no errors', p2.consoleErrors.length === 0, p2.consoleErrors.join(' | '))
    await c2.close()
  }

  // ── ops_admin ──────────────────────────────────────────────────────────────
  {
    const { ctx: c3, page: p3 } = await login(browser, 'ops@ocar.com')
    const kpiResponses = []
    p3.on('response', async r => { if (r.url().includes('/analytics/kpis')) kpiResponses.push(await r.json().catch(() => null)) })
    await open(p3)
    ok('ops: Reports is reachable', (await p3.getByRole('link', { name: 'Reports' }).count()) > 0)
    ok('ops: no Finance tab', (await p3.getByRole('tab', { name: 'Finance' }).count()) === 0)
    ok('ops: no Export button', (await p3.getByRole('button', { name: 'Export CSV' }).count()) === 0)
    ok('ops: no Gross bookings or Ocar revenue tiles', (await p3.getByText('Gross bookings').count()) === 0 && (await p3.getByText('Ocar revenue', { exact: true }).count()) === 0)
    ok('ops: non-money tiles present', (await p3.getByText('Completed rides').count()) > 0 && (await p3.getByText('Active drivers').count()) > 0)
    ok('ops: API payload has money absent', kpiResponses.length > 0 && kpiResponses.every(j => j && j.money_hidden === true && !('gross_bookings' in j.totals)), JSON.stringify(kpiResponses[0]?.totals))
    ok('ops: trend chart offers no money metrics', (await p3.getByRole('tab', { name: 'Gross bookings' }).count()) === 0 && (await p3.getByRole('tab', { name: 'Completed rides' }).count()) > 0)
    let kpiCalls = 0
    p3.on('request', r => { if (r.url().includes('/analytics/kpis')) kpiCalls++ })
    await open(p3, '?tab=finance')
    await p3.waitForTimeout(2500)
    ok('ops: ?tab=finance does not refetch in a loop', kpiCalls <= 2, String(kpiCalls))
    ok('ops: ?tab=finance falls back to Overview', (await p3.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')) === 'true')
    await open(p3, '?tab=drivers')
    ok('ops: drivers table has no Earnings column', (await p3.getByRole('columnheader', { name: 'Earnings' }).count()) === 0)
    ok('ops: no uncaught page errors', p3.consoleErrors.length === 0, p3.consoleErrors.join(' | '))
    await c3.close()
  }
} finally {
  await browser.close()
}
const failed = results.filter(r => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
