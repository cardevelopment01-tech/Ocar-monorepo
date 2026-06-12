'use client'
import { DEMO_MODE } from '@/lib/demo'
import DemoBlock from '@/components/ui/DemoBlock'

export default function DisputeDetailPage() {
  if (DEMO_MODE) return <DemoBlock feature="Dispute Details" />
  return <div className="p-6 text-text-muted">Dispute detail coming soon.</div>
}
