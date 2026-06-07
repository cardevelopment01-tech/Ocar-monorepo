import { describe, it } from 'vitest'

describe('M03 — Driver Onboarding', () => {
  describe('Driver registration flow', () => {
    it.todo('TC-M03-001: driver submits personal details creates pending_docs record')
    it.todo('TC-M03-002: driver uploads driving license changes doc_status to pending')
    it.todo('TC-M03-003: admin approves doc changes status to approved')
    it.todo('TC-M03-004: all docs approved moves driver to pending_approval')
    it.todo('TC-M03-005: admin approves driver changes status to active')
    it.todo('TC-M03-006: daily selfie verification passes sets auto_passed')
    it.todo('TC-M03-007: expired document triggers notification')
  })
})
