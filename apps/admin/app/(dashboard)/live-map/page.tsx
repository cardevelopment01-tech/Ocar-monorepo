'use client'
import DemoBlock from '@/components/ui/DemoBlock'
import { DEMO_MODE } from '@/lib/demo'

export default function LiveMapPage() {
  if (DEMO_MODE) return <DemoBlock feature="Live Map" />
  return <div className="p-6 text-text-muted">Live map coming soon (M11).</div>
}
