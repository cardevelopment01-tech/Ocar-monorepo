import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
const { removeLocationService } = createRequire(import.meta.url)('./withoutLocationService.js') as {
  removeLocationService: (m: { $?: Record<string, string>; application: { service?: { $: Record<string, string> }[] }[] }) => { $: Record<string, string>; application: { service: { $: Record<string, string> }[] }[] }
}

const SERVICE = 'expo.modules.location.services.LocationTaskService'

describe('removeLocationService', () => {
  it('marks the location foreground service for removal and enables the tools namespace', () => {
    const out = removeLocationService({ application: [{}] })
    expect(out.$['xmlns:tools']).toBe('http://schemas.android.com/tools')
    expect(out.application[0]!.service).toEqual([{ $: { 'android:name': SERVICE, 'tools:node': 'remove' } }])
  })

  it('keeps other services and does not add the removal twice', () => {
    const other = { $: { 'android:name': 'com.example.Other' } }
    const once = removeLocationService({ application: [{ service: [other] }] })
    const twice = removeLocationService(once)
    expect(twice.application[0]!.service).toHaveLength(2)
    expect(twice.application[0]!.service[0]).toBe(other)
  })
})
