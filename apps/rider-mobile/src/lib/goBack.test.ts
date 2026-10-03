import { describe, expect, it, vi } from 'vitest'
import { goBack } from './goBack'

const fakeRouter = (canGoBack: boolean) => ({ canGoBack: () => canGoBack, back: vi.fn(), replace: vi.fn() })

describe('goBack', () => {
  it('goes back when there is history', () => {
    const r = fakeRouter(true)
    goBack(r)
    expect(r.back).toHaveBeenCalledOnce()
    expect(r.replace).not.toHaveBeenCalled()
  })

  it('replaces with home when the screen was opened cold', () => {
    const r = fakeRouter(false)
    goBack(r)
    expect(r.back).not.toHaveBeenCalled()
    expect(r.replace).toHaveBeenCalledWith('/(tabs)/home')
  })

  it('replaces with the given fallback', () => {
    const r = fakeRouter(false)
    goBack(r, '/ride/42')
    expect(r.replace).toHaveBeenCalledWith('/ride/42')
  })
})
