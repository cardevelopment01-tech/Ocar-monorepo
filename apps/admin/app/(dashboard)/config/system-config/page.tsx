'use client'
import { DEMO_MODE } from '@/lib/demo'
import DemoBlock from '@/components/ui/DemoBlock'
import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import { mockSystemConfig } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Config = typeof mockSystemConfig[number]

const GROUPS = ['All', 'Dispatch', 'Pricing', 'Wallet', 'OTP', 'Payments', 'Notifications']

export default function SystemConfigPage() {
  if (DEMO_MODE) return <DemoBlock feature="System Config" />

  const [activeGroup, setActiveGroup] = useState('All')
  const [editing, setEditing] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(mockSystemConfig.map(c => [c.key, c.value]))
  )
  const [draft, setDraft] = useState('')

  const visible = activeGroup === 'All'
    ? mockSystemConfig
    : mockSystemConfig.filter(c => c.group === activeGroup)

  const startEdit = (c: Config) => { setEditing(c.key); setDraft(values[c.key]) }
  const saveEdit  = (key: string) => { setValues(v => ({ ...v, [key]: draft })); setEditing(null) }
  const cancelEdit = () => setEditing(null)

  return (
    <div className="space-y-5">
      {/* Group tabs */}
      <div className="flex gap-1 bg-surface rounded-2xl p-1.5 border border-border w-fit">
        {GROUPS.map(g => (
          <button
            key={g}
            onClick={() => setActiveGroup(g)}
            className={cn(
              'px-4 py-1.5 rounded-xl text-sm font-semibold transition-all',
              activeGroup === g
                ? 'bg-primary text-white shadow-sm'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-2'
            )}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Config table */}
      <div className="admin-card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '280px' }}>Key</th>
              <th>Description</th>
              <th style={{ width: '200px' }}>Current Value</th>
              <th style={{ width: '120px' }}>Default</th>
              <th style={{ width: '80px' }}>Edit</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(c => {
              const isModified = values[c.key] !== c.default
              const isEditing  = editing === c.key
              return (
                <tr
                  key={c.key}
                  className={cn('group', isModified && 'border-l-2 border-l-primary')}
                >
                  <td>
                    <div>
                      <code className="text-xs font-mono text-primary">{c.key}</code>
                      {isModified && (
                        <span className="ml-2 pill pill-info text-[10px]">Modified</span>
                      )}
                    </div>
                  </td>
                  <td className="text-text-muted text-xs">{c.description}</td>
                  <td>
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        {c.type === 'boolean' ? (
                          <button
                            onClick={() => setDraft(d => d === 'true' ? 'false' : 'true')}
                            className={cn(
                              'w-10 h-5 rounded-full transition-colors relative',
                              draft === 'true' ? 'bg-primary' : 'bg-border'
                            )}
                          >
                            <span className={cn(
                              'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                              draft === 'true' ? 'translate-x-5' : 'translate-x-0'
                            )} />
                          </button>
                        ) : (
                          <input
                            type={c.type === 'decimal' ? 'number' : 'text'}
                            value={draft}
                            onChange={e => setDraft(e.target.value)}
                            step={c.type === 'decimal' ? '0.1' : undefined}
                            className="w-24 px-2 py-1 text-xs border border-primary rounded-lg outline-none font-mono"
                            autoFocus
                          />
                        )}
                        <button onClick={() => saveEdit(c.key)} className="text-success hover:bg-success-light rounded p-0.5">
                          <Check size={14} />
                        </button>
                        <button onClick={cancelEdit} className="text-text-muted hover:bg-surface-2 rounded p-0.5">
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className={cn('font-mono text-sm font-semibold', isModified ? 'text-primary' : 'text-text-primary')}>
                        {c.type === 'boolean'
                          ? <span className={cn('pill', values[c.key] === 'true' ? 'pill-success' : 'pill-muted')}>{values[c.key]}</span>
                          : values[c.key]
                        }
                      </span>
                    )}
                  </td>
                  <td className="font-mono text-xs text-text-muted">{c.default}</td>
                  <td>
                    {!isEditing && (
                      <button
                        onClick={() => startEdit(c)}
                        className="text-text-muted hover:text-primary transition-colors p-1 rounded hover:bg-primary-light"
                      >
                        <Pencil size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
