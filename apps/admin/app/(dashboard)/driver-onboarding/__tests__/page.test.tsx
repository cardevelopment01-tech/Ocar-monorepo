// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReminderReport, ReminderRow } from '@/lib/kyc-reminders-api'

const api = vi.hoisted(() => ({ report: vi.fn() }))
vi.mock('@/lib/kyc-reminders-api', () => ({ kycRemindersApi: api }))

import DriverOnboardingPage from '../page'

const row = (id: string, over: Partial<ReminderRow> = {}): ReminderRow => ({
  driverId: id, name: `Driver ${id}`, phone: `+9199000000${id}`, step: 'documents', lastProgressAt: '2026-11-20T04:00:00Z',
  state: 'reminded', sends: [{ n: 1, sentAt: '2026-11-22T05:00:00Z', result: 'reached' }], lastResult: 'reached', ...over,
})
const report = (rows: ReminderRow[]): ReminderReport => ({ summary: { stalled: 3, reminded: 3, cameBack: 1, notReached: 1 }, rows })

beforeEach(() => { vi.clearAllMocks() })

describe('Onboarding follow-up page', () => {
  it('shows who stopped where and whether each reminder reached the phone, in words', async () => {
    api.report.mockResolvedValue(report([
      row('1'),
      row('2', { sends: [{ n: 1, sentAt: '2026-11-22T05:00:00Z', result: 'no_device' }], lastResult: 'no_device' }),
      row('3', { state: 'came_back' }),
      row('4', { sends: [], lastResult: null, state: 'not_due', step: 'personal_info' }),
    ]))
    render(<DriverOnboardingPage />)
    await waitFor(() => expect(screen.getByText('Driver 1')).toBeTruthy())
    const table = within(screen.getByRole('table'))
    expect(table.getAllByText('Reached the device')).toHaveLength(2) // drivers 1 and 3
    expect(table.getByText('No device, in-app only')).toBeTruthy()
    expect(table.getByText('Came back')).toBeTruthy()
    expect(table.getByText('Nothing sent')).toBeTruthy()
    expect(screen.getByText('3 stalled')).toBeTruthy()
    expect(screen.getByText('1 not reached')).toBeTruthy()
  })
  it('asks the server for only the chosen result when filtering', async () => {
    api.report.mockResolvedValue(report([row('1')]))
    render(<DriverOnboardingPage />)
    await waitFor(() => expect(screen.getByText('Driver 1')).toBeTruthy())
    await userEvent.selectOptions(screen.getByLabelText('Last result'), 'no_device')
    await waitFor(() => expect(api.report).toHaveBeenLastCalledWith({ result: 'no_device' }))
  })
  it('shows a retry when the report cannot load', async () => {
    api.report.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(report([row('1')]))
    render(<DriverOnboardingPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByText('Driver 1')).toBeTruthy())
  })
})
