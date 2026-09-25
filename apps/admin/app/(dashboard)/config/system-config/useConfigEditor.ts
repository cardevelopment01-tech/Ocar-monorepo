'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { systemConfigApi, type SystemConfig } from '@/lib/system-config-api'
import { extractErrorMessage } from '@/lib/http-errors'
import { formatValue, resolve, validateDraft, type Resolved } from '@/lib/system-config-model'

export interface PendingChange {
  r: Resolved
  from: string
  to: string
  /** Inline validation problem; a change with an error can't be reviewed/saved. */
  error: string | null
}

export type LoadStatus = 'loading' | 'ready' | 'error'

/**
 * Owns the page's data: the last-saved values, the admin's unsaved drafts, and saving.
 * Saves are per-key PATCHes carrying the updatedAt this screen last saw, so if another
 * admin changed the same setting the API answers 409 rather than silently overwriting
 * them. On a conflict we refetch, keep the admin's draft, and say what the value became.
 */
export function useConfigEditor() {
  const [configs, setConfigs] = useState<SystemConfig[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      setConfigs(await systemConfigApi.list())
      setStatus('ready')
    } catch (err) {
      setLoadError(extractErrorMessage(err, 'Could not load settings.'))
      setStatus('error')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const changes: PendingChange[] = useMemo(
    () => configs
      .filter(c => c.id in drafts)
      .map(c => {
        const r = resolve(c)
        return { r, from: c.value, to: drafts[c.id]!, error: validateDraft(r, drafts[c.id]!) }
      }),
    [configs, drafts],
  )

  const setDraft = useCallback((id: string, value: string) => {
    setRowNotes(n => { if (!(id in n)) return n; const { [id]: _drop, ...rest } = n; return rest })
    setDrafts(d => {
      const base = configs.find(c => c.id === id)
      if (base && base.value === value) { const { [id]: _drop, ...rest } = d; return rest }
      return { ...d, [id]: value }
    })
  }, [configs])

  const resetDraft = useCallback((id: string) => {
    setDrafts(d => { const { [id]: _drop, ...rest } = d; return rest })
    setRowNotes(n => { const { [id]: _drop, ...rest } = n; return rest })
  }, [])

  const discardAll = useCallback(() => { setDrafts({}); setRowNotes({}) }, [])

  const save = useCallback(async (): Promise<{ saved: number; failed: number }> => {
    setSaving(true)
    const byId = new Map(configs.map(c => [c.id, c]))
    const remaining = { ...drafts }
    const notes: Record<string, string> = {}
    const conflicts: string[] = []
    let saved = 0

    // Sequential on purpose: a stable audit-log order, and one failure never hides another.
    for (const ch of changes) {
      const id = ch.r.config.id
      try {
        const updated = await systemConfigApi.update(id, ch.to, ch.r.config.updatedAt)
        byId.set(id, updated)
        delete remaining[id]
        saved++
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 409) conflicts.push(id)
        else notes[id] = extractErrorMessage(err, 'Couldn’t save this setting. Try again.')
      }
    }

    let list = configs.map(c => byId.get(c.id) ?? c)
    if (conflicts.length > 0) {
      try {
        const fresh = await systemConfigApi.list()
        list = fresh
        for (const id of conflicts) {
          const cur = fresh.find(c => c.id === id)
          if (!cur) { notes[id] = 'This setting no longer exists.'; delete remaining[id]; continue }
          if (remaining[id] === cur.value) { delete remaining[id]; continue } // they saved the same thing
          notes[id] = `Someone else changed this to ${formatValue(resolve(cur), cur.value)}. Your edit is kept. Save again to overwrite it.`
        }
      } catch {
        for (const id of conflicts) notes[id] = 'Someone else changed this setting. Reload the page to see the latest value.'
      }
    }

    setConfigs(list)
    setDrafts(remaining)
    setRowNotes(notes)
    setSaving(false)
    return { saved, failed: Object.keys(notes).length }
  }, [changes, configs, drafts])

  return { configs, status, loadError, load, drafts, rowNotes, changes, setDraft, resetDraft, discardAll, save, saving }
}
