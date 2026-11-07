// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import DriverProfileLoading from '../loading'

// Value: protects=a click on a driver showing something at once instead of leaving the list frozen until the server answers;
// fails_when=loading.tsx is removed or stops rendering a placeholder; why_new=new loading boundary for the dynamic route;
// seam=none; no_claim=Next's navigation itself (checked on the deployed site).
describe('driver profile loading state', () => {
  it('renders the placeholder bars and says it is busy', () => {
    const { container } = render(<DriverProfileLoading />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(6)
  })
})
