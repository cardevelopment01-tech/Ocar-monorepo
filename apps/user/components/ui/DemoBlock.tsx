'use client'

import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'

interface DemoBlockProps {
  feature: string
}

export default function DemoBlock({ feature }: DemoBlockProps) {
  const router = useRouter()

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 bg-background">
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #0A9FB0 0%, #DC3E93 100%)' }}
      >
        <Lock size={26} color="white" strokeWidth={1.8} />
      </div>

      <h2 className="text-lg font-bold text-text-primary mb-1.5 text-center">{feature}</h2>

      <p
        className="text-xs font-semibold uppercase tracking-widest mb-3 px-3 py-1 rounded-full"
        style={{ background: '#E4F8FA', color: '#0A9FB0' }}
      >
        Coming Soon
      </p>

      <p className="text-sm text-text-muted text-center max-w-xs leading-relaxed">
        We're working on this. Check back soon.
      </p>

      <button
        onClick={() => router.back()}
        className="mt-8 text-sm font-semibold text-primary active:opacity-70 transition-opacity"
      >
        ← Go back
      </button>
    </div>
  )
}
