import { useState, useCallback, useEffect } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { getApiBase } from '../constants'
import { isDemoMode } from '../lib/config'
import {
  listHistoryEntries,
  getHistoryEntry,
  deleteHistoryEntry,
  deleteHistoryEntries,
  putHistoryEntry,
  newId,
  isQuotaError,
} from '../lib/demoStore'

// Signing history: each export persists the original + result + layout so the
// user can re-download the result or reopen the original WITH its signature
// layout for further editing. In demo mode this lives in the browser
// (demoStore); otherwise it is the server-side history (history_service).
const api = () => `${getApiBase()}/api/history`

export function useSigningHistory() {
  const { t } = useI18n()
  const demo = isDemoMode()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      if (demo) {
        setEntries(await listHistoryEntries())
      } else {
        const res = await fetch(api())
        if (!res.ok) throw new Error(t('error.history_load_failed'))
        setEntries(await res.json())
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [demo, t])

  // The signed result as a Blob, for downloading. Demo keeps it in the browser
  // store; normal mode fetches it from the server-side history.
  const getResultBlob = useCallback(
    async (id) => {
      if (demo) {
        const entry = await getHistoryEntry(id)
        return entry?.resultBlob || null
      }
      const res = await fetch(`${api()}/${id}/result`)
      if (!res.ok) throw new Error(t('error.history_load_failed'))
      return res.blob()
    },
    [demo, t],
  )

  // Fetch one full entry, including the `pages` layout used to restore
  // signatures (and, in demo mode, the original document Blob).
  const getEntry = useCallback(
    async (id) => {
      if (demo) return getHistoryEntry(id)
      const res = await fetch(`${api()}/${id}`)
      if (!res.ok) throw new Error(t('error.history_load_failed'))
      return res.json()
    },
    [demo, t],
  )

  const remove = useCallback(
    async (id) => {
      if (demo) await deleteHistoryEntry(id)
      else await fetch(`${api()}/${id}`, { method: 'DELETE' })
      await load()
    },
    [demo, load],
  )

  // Multi-delete: fire the deletes, then reload once. Failures are ignored per
  // entry (a concurrently-removed entry 404s); the reload reflects reality.
  const removeMany = useCallback(
    async (ids) => {
      if (demo) await deleteHistoryEntries(ids)
      else
        await Promise.all(
          ids.map((id) => fetch(`${api()}/${id}`, { method: 'DELETE' }).catch(() => {})),
        )
      await load()
    },
    [demo, load],
  )

  // Demo only: persist a signing event in the browser. The server does this
  // itself in normal mode, so this is a no-op there.
  const addEntry = useCallback(
    async ({ file, resultBlob, pages, deletePages }) => {
      if (!demo) return
      const name = file?.name || 'document'
      const ext = (name.slice(name.lastIndexOf('.') + 1) || 'bin').toLowerCase()
      const pageCount = new Set(pages.map((p) => p.page_idx)).size
      try {
        await putHistoryEntry({
          id: newId(),
          filename: name,
          ext,
          page_count: pageCount,
          originalBlob: file,
          resultBlob,
          pages,
          delete_pages: deletePages,
          created_at: new Date().toISOString(),
        })
      } catch (e) {
        // The signed file already downloaded — a full browser store must not
        // surface as an export failure. Drop the (best-effort) history entry.
        if (isQuotaError(e)) {
          console.warn('Demo history storage full; entry not saved.', e)
          return
        }
        throw e
      }
      await load()
    },
    [demo, load],
  )

  // Auto-load once on mount so the header badge/count is correct.
  useEffect(() => {
    load()
  }, [load])

  return { entries, loading, error, reload: load, getEntry, getResultBlob, remove, removeMany, addEntry }
}
