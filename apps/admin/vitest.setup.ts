import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// RTL only auto-enables React's act() environment and auto-cleanup when test
// globals (beforeAll/afterEach) exist; this repo runs vitest without globals,
// so wire both explicitly or renders are scheduled outside act and never commit.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => { cleanup() })
