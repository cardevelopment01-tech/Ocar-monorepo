'use client'

import { useEffect, useState } from 'react'
import { Pencil, Check, X, ToggleLeft, ToggleRight } from 'lucide-react'
import SlideOver from '@/components/ui/SlideOver'
import { cn } from '@/lib/utils'
import { templatesApi, type NotificationTemplate } from '@/lib/templates-api'

const CHANNEL_LABEL: Record<string, string> = {
  sms: 'SMS', push: 'Push', voice: 'Voice', email: 'Email', whatsapp: 'WhatsApp', in_app: 'In-app',
}

export default function NotificationTemplatesPage() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<NotificationTemplate | null>(null)
  const [subjectDraft, setSubjectDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      setTemplates(await templatesApi.list())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const openEdit = (t: NotificationTemplate) => {
    setEditing(t)
    setSubjectDraft(t.subject ?? '')
    setBodyDraft(t.body)
  }

  const saveEdit = async () => {
    if (!editing) return
    setSaving(true)
    try {
      const updated = await templatesApi.update(editing.id, {
        subject: editing.subject !== null ? subjectDraft : null,
        body: bodyDraft,
      })
      setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t))
      setEditing(null)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (t: NotificationTemplate) => {
    const updated = await templatesApi.setActive(t.id, !t.isActive)
    setTemplates(prev => prev.map(x => x.id === updated.id ? updated : x))
  }

  return (
    <div className="space-y-5">
      <div className="admin-card">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '220px' }}>Name</th>
              <th style={{ width: '90px' }}>Channel</th>
              <th>Body preview</th>
              <th style={{ width: '70px' }}>Version</th>
              <th style={{ width: '90px' }}>Status</th>
              <th style={{ width: '80px' }}>Edit</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-text-muted text-xs py-6 text-center">Loading templates…</td></tr>
            ) : templates.length === 0 ? (
              <tr><td colSpan={6} className="text-text-muted text-xs py-6 text-center">No templates found.</td></tr>
            ) : templates.map(t => (
              <tr key={t.id}>
                <td>
                  <p className="text-sm font-semibold text-text-primary">{t.name}</p>
                  <code className="text-[11px] font-mono text-text-muted">{t.slug}</code>
                </td>
                <td>
                  <span className="pill pill-info text-[10px]">{CHANNEL_LABEL[t.channel] ?? t.channel}</span>
                </td>
                <td className="text-xs text-text-muted truncate max-w-[380px]">{t.body}</td>
                <td className="font-mono text-xs text-text-muted">v{t.version}</td>
                <td>
                  <button
                    onClick={() => void toggleActive(t)}
                    className={cn(
                      'flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg transition-colors',
                      t.isActive ? 'pill pill-success' : 'pill pill-muted'
                    )}
                  >
                    {t.isActive ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
                    {t.isActive ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td>
                  <button
                    onClick={() => openEdit(t)}
                    className="text-text-muted hover:text-primary transition-colors p-1 rounded hover:bg-primary-light"
                  >
                    <Pencil size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <SlideOver isOpen={!!editing} onClose={() => setEditing(null)} title={editing?.name ?? ''}>
        {editing && (
          <div className="p-6 space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="pill pill-info text-[10px]">{CHANNEL_LABEL[editing.channel] ?? editing.channel}</span>
              <span className="pill pill-muted text-[10px]">{editing.locale}</span>
              <span className="pill pill-muted text-[10px] font-mono">v{editing.version}</span>
            </div>

            {editing.subject !== null && (
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5">Subject</label>
                <input
                  value={subjectDraft}
                  onChange={e => setSubjectDraft(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-text-secondary mb-1.5">Body</label>
              <textarea
                value={bodyDraft}
                onChange={e => setBodyDraft(e.target.value)}
                rows={5}
                className="w-full px-3 py-2 text-sm border border-border rounded-xl outline-none focus:border-primary transition-colors font-mono resize-none"
              />
            </div>

            <div>
              <p className="text-xs font-semibold text-text-secondary mb-1.5">Variables</p>
              <div className="flex flex-wrap gap-1.5">
                {editing.variablesSchema.required.map(v => (
                  <code key={v} className="text-[11px] font-mono bg-surface-2 text-primary px-2 py-1 rounded-lg">
                    {`{{${v}}}`} <span className="text-text-muted">required</span>
                  </code>
                ))}
                {editing.variablesSchema.optional.map(v => (
                  <code key={v} className="text-[11px] font-mono bg-surface-2 text-text-muted px-2 py-1 rounded-lg">
                    {`{{${v}}}`} optional
                  </code>
                ))}
                {editing.variablesSchema.required.length === 0 && editing.variablesSchema.optional.length === 0 && (
                  <span className="text-xs text-text-muted">No variables</span>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-text-secondary border border-border hover:bg-surface-2 transition-colors"
              >
                <X size={14} className="inline mr-1.5 -mt-0.5" />
                Cancel
              </button>
              <button
                onClick={() => void saveEdit()}
                disabled={saving || bodyDraft.trim().length === 0}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-primary hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <Check size={14} className="inline mr-1.5 -mt-0.5" />
                {saving ? 'Saving…' : 'Save (bumps version)'}
              </button>
            </div>
          </div>
        )}
      </SlideOver>
    </div>
  )
}
