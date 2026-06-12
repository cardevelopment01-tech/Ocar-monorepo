'use client'

import { useRouter } from 'next/navigation'
import { Lock } from 'lucide-react'

interface DemoBlockProps {
  feature: string
}

export default function DemoBlock({ feature }: DemoBlockProps) {
  const router = useRouter()

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[480px] px-8">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 flex-shrink-0"
        style={{ background: 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)' }}
      >
        <Lock size={22} color="white" strokeWidth={1.8} />
      </div>

      <h2 className="text-lg font-bold text-text-primary mb-1.5 text-center">{feature}</h2>

      <span
        className="text-[10px] font-bold uppercase tracking-widest mb-3 px-3 py-1 rounded-full"
        style={{ background: '#EEF2FF', color: '#4F46E5' }}
      >
        Coming Soon
      </span>

      <p className="text-sm text-text-muted text-center max-w-sm leading-relaxed">
        This module is in development and will be available in the next release.
      </p>

      <button
        onClick={() => router.back()}
        className="mt-7 text-sm font-semibold text-primary hover:opacity-75 transition-opacity cursor-pointer"
      >
        ← Go back
      </button>
    </div>
  )
}
