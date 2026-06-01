import { useState, useCallback, useEffect, useRef } from 'react'
import { useI18n, resolveApiError } from '../i18n/index.jsx'
import { getApiBase } from '../constants'
import { isDemoMode } from '../lib/config'
import { dataUrlToBlob, blobToDataUrl } from '../lib/blobCodec'
import {
  putSignature,
  listSignatures,
  getSignature,
  deleteSignature,
  renameSignature as renameInStore,
  objectUrlFor,
  revokeObjectUrl,
  revokeAllObjectUrls,
  isQuotaError,
} from '../lib/demoStore'

// Built at request time, not module-load: the Tauri API base is only known
// after resolveApiBase() runs (dynamic sidecar port).
const api = () => `${getApiBase()}/api/signatures`

// In demo mode the server stores nothing: the upload endpoint still runs
// background removal and returns the processed PNG as base64, but the browser
// keeps the only copy in IndexedDB (demoStore). Otherwise the library is the
// server's signatures directory, fetched/mutated over /api/signatures.
export function useSignatures() {
  const { t } = useI18n()
  const demo = isDemoMode()
  const [signatures, setSignatures] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Demo only: id -> object URL, kept in sync with the store so imageUrl(id) is
  // synchronous (SignatureItem/CanvasEditor read it during render).
  const urlsRef = useRef(new Map())

  const loadDemo = useCallback(async () => {
    const records = await listSignatures()
    const next = new Map()
    for (const r of records) next.set(r.id, objectUrlFor(r.id, r.blob))
    for (const id of urlsRef.current.keys()) {
      if (!next.has(id)) revokeObjectUrl(id)
    }
    urlsRef.current = next
    setSignatures(records.map(({ id, name }) => ({ id, name })))
  }, [])

  const loadServer = useCallback(async () => {
    const res = await fetch(api())
    if (!res.ok) throw new Error(t('error.load_signatures_failed'))
    setSignatures(await res.json())
  }, [t])

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      await (demo ? loadDemo() : loadServer())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [demo, loadDemo, loadServer])

  useEffect(() => {
    load()
    return () => {
      if (demo) revokeAllObjectUrls()
    }
  }, [load, demo])

  const upload = useCallback(
    async (file, removeBg = true) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${api()}?remove_bg=${removeBg}`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(resolveApiError(body.detail, t))
      }
      const body = await res.json()
      // Demo: server returns {id,name,image(base64)} and persists nothing — keep
      // the only copy locally.
      if (demo) {
        let blob
        try {
          blob = dataUrlToBlob(body.image)
        } catch {
          // Malformed/absent base64 in the response — fail with a clean message
          // instead of an uncaught atob exception.
          throw new Error(t('error.load_signatures_failed'))
        }
        try {
          await putSignature({ id: body.id, name: body.name, blob })
        } catch (e) {
          throw new Error(isQuotaError(e) ? t('error.demo_quota') : e.message, {
            cause: e,
          })
        }
      }
      await load()
      return body
    },
    [demo, load, t],
  )

  const remove_ = useCallback(
    async (id) => {
      if (demo) await deleteSignature(id)
      else await fetch(`${api()}/${id}`, { method: 'DELETE' })
      await load()
    },
    [demo, load],
  )

  // Multi-delete: fire all deletes, then reload once.
  const removeMany = useCallback(
    async (ids) => {
      if (demo) await Promise.all(ids.map((id) => deleteSignature(id)))
      else
        await Promise.all(
          ids.map((id) => fetch(`${api()}/${id}`, { method: 'DELETE' }).catch(() => {})),
        )
      await load()
    },
    [demo, load],
  )

  const rename = useCallback(
    async (id, name) => {
      if (demo) {
        await renameInStore(id, name)
      } else {
        const res = await fetch(`${api()}/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(resolveApiError(body.detail, t))
        }
      }
      await load()
    },
    [demo, load, t],
  )

  const imageUrl = useCallback(
    (id) => (demo ? urlsRef.current.get(id) || '' : `${api()}/${id}/image`),
    [demo],
  )

  // Demo export ships the signature pixels inline (the server keeps nothing), so
  // collect {id: dataURL} for the unique ids placed, read back from the store.
  const getSignatureData = useCallback(async (ids) => {
    const out = {}
    for (const id of ids) {
      const rec = await getSignature(id)
      if (rec?.blob) out[id] = await blobToDataUrl(rec.blob)
    }
    return out
  }, [])

  return {
    signatures,
    loading,
    error,
    upload,
    remove: remove_,
    removeMany,
    rename,
    imageUrl,
    reload: load,
    getSignatureData,
  }
}
