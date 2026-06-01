import { useState, useCallback } from 'react'
import { useI18n, resolveApiError } from '../i18n/index.jsx'
import { getApiBase } from '../constants'
import { isDemoMode } from '../lib/config'
import { buildExportPayload } from '../lib/exportPayload'
import { saveBlob } from '../lib/download'

// Owns the "produce the signed file" concern: building the export request,
// downloading the result, recording history, and reopening a past export for
// editing. Extracted from App so the component stays under the filesize gate and
// the export flow is testable in isolation. Demo vs normal branching lives here.
//
// Refs (layersByPageRef, sourceFileRef, pendingLayersRef, pendingDeletedRef) are
// owned by App and threaded in; `closeHistory` lets reopen dismiss the modal.
export function useExport({
  doc,
  sigs,
  history,
  layersByPageRef,
  sourceFileRef,
  pendingLayersRef,
  pendingDeletedRef,
  deletedPages,
  hasSigs,
  closeHistory,
}) {
  const { t } = useI18n()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)

  // Reopen a past export for editing: fetch its original bytes + restore the
  // placed-signature layout, then load it as the current document. The layer
  // restore happens in App's load-reset effect via pendingLayersRef.
  const handleReopen = useCallback(
    async (entryId) => {
      try {
        const meta = await history.getEntry(entryId)
        // Demo keeps the original document Blob in the browser store; otherwise
        // fetch it back from the server-side history.
        let blob
        if (isDemoMode()) {
          blob = meta.originalBlob
          if (!blob) throw new Error(t('error.history_load_failed'))
        } else {
          const res = await fetch(`${getApiBase()}/api/history/${entryId}/original`)
          if (!res.ok) throw new Error(t('error.history_load_failed'))
          blob = await res.blob()
        }
        const file = new File([blob], meta.filename || 'document', { type: blob.type })
        const layers = {}
        for (const p of meta.pages || []) {
          const sigLayers = (p.signatures || []).map((s, i) => ({
            id: `${s.id}-h${p.page_idx}-${i}`,
            type: 'signature',
            sigId: s.id,
            x: s.x, y: s.y, width: s.w, height: s.h,
            rotation: s.angle ?? 0, opacity: s.opacity ?? 1, jitter: s.jitter ?? 0,
          }))
          const textLayers = (p.texts || []).map((tx, i) => ({
            id: `text-${p.page_idx}-${i}-${tx.x}`,
            type: 'text',
            text: tx.text ?? '',
            x: tx.x, y: tx.y, width: 240,
            fontSize: tx.fontSize ?? 32,
            fontFamily: tx.family ?? 'sans',
            bold: !!tx.bold, italic: !!tx.italic,
            color: tx.color ?? '#111827',
            align: tx.align ?? 'left',
            rotation: tx.angle ?? 0, opacity: tx.opacity ?? 1,
          }))
          layers[p.page_idx] = [...sigLayers, ...textLayers]
        }
        pendingLayersRef.current = layers
        pendingDeletedRef.current = new Set(meta.delete_pages || [])
        sourceFileRef.current = file
        closeHistory()
        doc.loadFile(file)
      } catch (e) {
        setExportError(e.message)
      }
    },
    [history, doc, t, pendingLayersRef, pendingDeletedRef, sourceFileRef, closeHistory],
  )

  const handleExport = async () => {
    if (!sourceFileRef.current) return
    if (!hasSigs && deletedPages.size === 0) return
    if (doc.totalPages > 0 && deletedPages.size >= doc.totalPages) {
      setExportError(t('error.all_pages_deleted'))
      return
    }
    setExporting(true)
    setExportError(null)
    try {
      const pagesPayload = buildExportPayload({
        layersByPage: layersByPageRef.current,
        pageDims: doc.pageDims,
        deletedPages,
      })
      if (pagesPayload.length === 0 && deletedPages.size === 0) return

      const form = new FormData()
      form.append('file', sourceFileRef.current)
      form.append('pages', JSON.stringify(pagesPayload))
      form.append('delete_pages', JSON.stringify([...deletedPages]))
      // Demo: the server has no signature store, so ship the pixels of the
      // unique signatures placed inline with the request.
      if (isDemoMode()) {
        const usedIds = [...new Set(pagesPayload.flatMap((p) => p.signatures.map((s) => s.id)))]
        form.append('signatures_data', JSON.stringify(await sigs.getSignatureData(usedIds)))
      }

      const res = await fetch(`${getApiBase()}/api/export`, { method: 'POST', body: form })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(resolveApiError(body.detail, t))
      }

      const blob = await res.blob()
      const srcName = sourceFileRef.current.name
      const srcExt = srcName.slice(srcName.lastIndexOf('.') + 1).toLowerCase()
      const outName = 'signed.' + (srcName.toLowerCase().endsWith('.pdf') ? 'pdf' : srcExt)
      // Native Save dialog in the app; anchor download in the browser/Docker.
      await saveBlob(outName, blob)
      // Normal mode persisted a history entry server-side — refresh the list.
      // Demo mode has no server store, so record the entry in the browser.
      if (isDemoMode()) {
        await history.addEntry({
          file: sourceFileRef.current,
          resultBlob: blob,
          pages: pagesPayload,
          deletePages: [...deletedPages],
        })
      } else {
        history.reload()
      }
    } catch (e) {
      setExportError(e.message)
    } finally {
      setExporting(false)
    }
  }

  return { exporting, exportError, setExportError, handleExport, handleReopen }
}
