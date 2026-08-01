import { CheckCircle2, Shield, Car } from 'lucide-react'

export default function SectionHeader({ icon, label, done }: { icon: 'driver' | 'vehicle'; label: string; done: boolean }) {
  return (
    <div className="flex items-center gap-2 pt-2 pb-1">
      <div className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${done ? 'bg-green-500/15' : 'bg-primary/10'}`}>
        {icon === 'driver'
          ? <Shield size={13} className={done ? 'text-green-500' : 'text-primary'} />
          : <Car    size={13} className={done ? 'text-green-500' : 'text-primary'} />}
      </div>
      <p className="text-sm font-bold text-text-primary">{label}</p>
      {done && <CheckCircle2 size={14} className="text-green-500 ml-auto" />}
    </div>
  )
}
