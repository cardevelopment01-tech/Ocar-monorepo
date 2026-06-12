'use client'
import DemoBlock from '@/components/ui/DemoBlock'
import { DEMO_MODE } from '@/lib/demo'

export default function AnalyticsPage() {
  if (DEMO_MODE) return <DemoBlock feature="Analytics & Reports" />
  return <div className="p-6 text-text-muted">Analytics coming soon (M12).</div>
}
