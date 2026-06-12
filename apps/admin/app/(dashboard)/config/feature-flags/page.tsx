'use client'
import DemoBlock from '@/components/ui/DemoBlock'
import { DEMO_MODE } from '@/lib/demo'

export default function FeatureFlagsPage() {
  if (DEMO_MODE) return <DemoBlock feature="Feature Flags" />
  return <div className="p-6 text-text-muted">Feature flags coming soon (M11).</div>
}
