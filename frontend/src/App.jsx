import { useState, useRef, useCallback, useEffect } from 'react'
import './index.css'
import { useDocument } from './hooks/useDocument'
import { useSignatures } from './hooks/useSignatures'
import { useSigningHistory } from './hooks/useSigningHistory'
import { CanvasEditor } from './components/CanvasEditor'
import { SignatureLibrary } from './components/SignatureLibrary'
import { AboutModal } from './components/AboutModal'
import { HistoryModal } from './components/HistoryModal'
import { LanguageSwitcher } from './i18n/LanguageSwitcher'
import { DemoBanner } from './components/DemoBanner'
import { useI18n, resolveApiError } from './i18n/index.jsx'
import { FALLBACK_DIMS, getApiBase } from './constants'
import { isDemoMode } from './lib/config'
import { buildExportPayload, signAllPages } from './lib/exportPayload'

const ALLOWED = '.pdf,.jpg,.jpeg,.png,.tiff,.tif,.webp'

export default function App() {
  const { t } = useI18n()
  const doc = useDocument()
  const sigs = useSignatures()
  const history = useSigningHistory()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [removeBg, setRemoveBg] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [sigError, setSigError] = useState(null)
  const [hasSigs, setHasSigs] = useState(false)
  const [deletedPages, setDeletedPages] = useState(() => new Set())  // pages excluded from export
  const [selectedSigs, setSelectedSigs] = useState(() => new Set())  // library multi-select
  const [showAbout, setShowAbout] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const layersByPageRef = useRef({})  // page index -> layer[]
  // Reopening a history entry must restore its layers AFTER the new document
  // loads (the load resets the per-page store). These refs carry the restored
  // state into the load-reset effect below.
  const pendingLayersRef = useRef(null)
  const pendingDeletedRef = useRef(null)
  const [editorKey, setEditorKey] = useState(0)  // bump to remount the editor
  const sourceFileRef = useRef(null)
  const sigInputRef = useRef(null)
  const [undoState, setUndoState] = useState({ undo: null, redo: null, canUndo: false, canRedo: false })

  const handleUndoStateChange = useCallback((state) => setUndoState(state), [])

  // Reset per-page layers whenever a new document is loaded. If a reopen is
  // pending (from history), restore that layout instead of starting blank.
  useEffect(() => {
    const pending = pendingLayersRef.current
    if (pending) {
      pendingLayersRef.current = null
      const del = pendingDeletedRef.current || new Set()
      pendingDeletedRef.current = null
      layersByPageRef.current = pending
      setDeletedPages(del)
      setHasSigs(
        Object.entries(pending).some(
          ([idx, l]) => l.length > 0 && !del.has(Number(idx)),
        ),
      )
    } else {
      layersByPageRef.current = {}
      setHasSigs(false)
      setDeletedPages(new Set())
    }
    setEditorKey((k) => k + 1)
  }, [doc.loadId])

  const toggleDeletePage = () => {
    const next = new Set(deletedPages)
    if (next.has(doc.currentPage)) next.delete(doc.currentPage)
    else next.add(doc.currentPage)
    setDeletedPages(next)
    recomputeHasSigs(next)  // a deleted page must not count toward "ready to export"
  }

  // A manually-opened document must never inherit a history reopen's layout —
  // clear any pending restore so a failed reopen (which wouldn't bump loadId)
  // can't leak its layers onto the next document the user opens.
  const clearPendingReopen = () => {
    pendingLayersRef.current = null
    pendingDeletedRef.current = null
  }

  const handleFileInput = (e) => {
    const f = e.target.files?.[0]
    if (f) { clearPendingReopen(); sourceFileRef.current = f; doc.loadFile(f) }
  }
  const handleDrop = (e) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('application/signature')) return
    const f = e.dataTransfer?.files?.[0]
    if (f) { clearPendingReopen(); sourceFileRef.current = f; doc.loadFile(f) }
  }

  const handleSigUpload = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setSigError(null)
    setUploading(true)
    try { await sigs.upload(f, removeBg) } catch (err) { setSigError(err.message) }
    finally { setUploading(false); e.target.value = '' }
  }

  // True when at least one NON-deleted page carries a signature.
  const recomputeHasSigs = (deleted) =>
    setHasSigs(
      Object.entries(layersByPageRef.current).some(
        ([idx, l]) => l.length > 0 && !deleted.has(Number(idx)),
      ),
    )

  const handleLayersChange = useCallback((layers) => {
    layersByPageRef.current[doc.currentPage] = layers
    recomputeHasSigs(deletedPages)
  }, [doc.currentPage, deletedPages])

  // Copy the current page's signatures onto every (non-deleted) page.
  const handleSignAll = () => {
    const cur = layersByPageRef.current[doc.currentPage] || []
    if (cur.length === 0) return
    Object.assign(layersByPageRef.current, signAllPages(cur, doc.totalPages, deletedPages))
    setHasSigs(true)
    setEditorKey((k) => k + 1)
  }

  // --- Signature library multi-select ---
  const toggleSelectSig = useCallback((id) => {
    setSelectedSigs((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const deleteSelectedSigs = async () => {
    const ids = [...selectedSigs]
    if (ids.length === 0) return
    await sigs.removeMany(ids)
    setSelectedSigs(new Set())
  }

  // Reopen a past export for editing: fetch its original bytes + restore the
  // placed-signature layout, then load it as the current document. The layer
  // restore happens in the load-reset effect via pendingLayersRef.
  const handleReopen = useCallback(async (entryId) => {
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
        layers[p.page_idx] = (p.signatures || []).map((s, i) => ({
          id: `${s.id}-h${p.page_idx}-${i}`,
          sigId: s.id,
          x: s.x, y: s.y, width: s.w, height: s.h,
          rotation: s.angle ?? 0, opacity: s.opacity ?? 1, jitter: s.jitter ?? 0,
        }))
      }
      pendingLayersRef.current = layers
      pendingDeletedRef.current = new Set(meta.delete_pages || [])
      sourceFileRef.current = file
      setShowHistory(false)
      doc.loadFile(file)
    } catch (e) {
      setExportError(e.message)
    }
  }, [history, doc, t])

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
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const srcName = sourceFileRef.current.name
      const srcExt = srcName.slice(srcName.lastIndexOf('.') + 1).toLowerCase()
      a.download = 'signed.' + (srcName.toLowerCase().endsWith('.pdf') ? 'pdf' : srcExt)
      a.click()
      // Defer revoke so the download isn't cancelled in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
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

  const docLoaded = doc.totalPages > 0
  // Real pixel size of the current page; the Konva stage and the export payload
  // both use it so the page aspect ratio is preserved (backend sx == sy).
  const pageDims = doc.pageDims[doc.currentPage] || FALLBACK_DIMS

  // Step progress: 1=open doc, 2=upload sig, 3=drag to doc, 4=export
  const step = !docLoaded ? 1 : sigs.signatures.length === 0 ? 2 : !hasSigs ? 3 : 4

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>

      {/* Left: Signature Library */}
      <SignatureLibrary
        step={step}
        removeBg={removeBg}
        onToggleRemoveBg={() => setRemoveBg((v) => !v)}
        uploading={uploading}
        onUpload={handleSigUpload}
        sigInputRef={sigInputRef}
        sigError={sigError}
        sigs={sigs}
        selectedSigs={selectedSigs}
        onClearSelection={() => setSelectedSigs(new Set())}
        onDeleteSelected={deleteSelectedSigs}
        onToggleSelect={toggleSelectSig}
      />

      {/* Center */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {isDemoMode() && <DemoBanner />}

        {/* Toolbar */}
        <header className="flex items-center gap-2 px-4 py-2 bg-white border-b shadow-sm text-sm flex-shrink-0">
          <label className="cursor-pointer bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 text-sm">
            {t('app.openDocument')}
            <input type="file" accept={ALLOWED} onChange={handleFileInput} className="hidden" />
          </label>

          {docLoaded && (
            <>
              <span className="text-gray-400 text-xs ml-1">{doc.fileName}</span>
              <div className="flex items-center gap-1 ml-auto">
                <button onClick={() => doc.goTo(doc.currentPage - 1)} disabled={doc.currentPage === 0}
                  className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-gray-100">‹</button>
                <span className={`text-xs px-2 ${deletedPages.has(doc.currentPage) ? 'text-red-500 line-through' : ''}`}>
                  {doc.currentPage + 1} / {doc.totalPages}
                </span>
                <button onClick={() => doc.goTo(doc.currentPage + 1)} disabled={doc.currentPage === doc.totalPages - 1}
                  className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-gray-100">›</button>
                {deletedPages.size > 0 && (
                  <span title={t('app.excludedHint')}
                    className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">
                    {t('app.excludedCount', { n: deletedPages.size })}
                  </span>
                )}
              </div>
              <div className="flex gap-2 ml-4">
                <button onClick={undoState.undo} disabled={!undoState.canUndo}
                  className="px-2 py-1 border rounded text-sm disabled:opacity-40 hover:bg-gray-100">↩ {t('app.undo')}</button>
                <button onClick={undoState.redo} disabled={!undoState.canRedo}
                  className="px-2 py-1 border rounded text-sm disabled:opacity-40 hover:bg-gray-100">↪ {t('app.redo')}</button>
                {doc.totalPages > 1 && (
                  <button onClick={handleSignAll} disabled={!hasSigs} title={t('app.signAllPagesHint')}
                    className="px-2 py-1 border rounded text-sm disabled:opacity-40 hover:bg-gray-100">{t('app.signAllPages')}</button>
                )}
                {doc.totalPages > 1 && (
                  <button onClick={toggleDeletePage}
                    title={deletedPages.has(doc.currentPage) ? t('app.restorePageHint') : t('app.deletePageHint')}
                    className={`px-2 py-1 border rounded text-sm hover:bg-gray-100 ${deletedPages.has(doc.currentPage) ? 'text-green-600 border-green-300' : 'text-red-500 border-red-200'}`}>
                    {deletedPages.has(doc.currentPage) ? t('app.restorePage') : t('app.deletePage')}
                  </button>
                )}
                <button
                  onClick={handleExport}
                  disabled={(!hasSigs && deletedPages.size === 0) || exporting}
                  className={`px-3 py-1 rounded text-sm transition-colors ${(hasSigs || deletedPages.size > 0) && !exporting ? 'bg-orange-500 text-white hover:bg-orange-600' : 'bg-gray-200 text-gray-400 cursor-not-allowed'}`}
                >
                  {exporting ? t('app.exporting') : `💾 ${t('app.export')}`}
                </button>
              </div>
            </>
          )}
          <div className={`flex items-center gap-2 ${docLoaded ? 'ml-2' : 'ml-auto'}`}>
            <button
              onClick={() => setShowHistory(true)}
              title={t('history.title')}
              aria-label={t('history.title')}
              className="relative w-7 h-7 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-blue-600 flex items-center justify-center"
            >
              🕑
              {history.entries.length > 0 && (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 rounded-full bg-blue-600 text-white text-[9px] leading-4 text-center">
                  {history.entries.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setShowAbout(true)}
              title={t('about.title')}
              aria-label={t('about.title')}
              className="w-7 h-7 rounded-full border border-gray-300 text-gray-500 hover:bg-gray-100 hover:text-blue-600 flex items-center justify-center font-semibold"
            >
              ?
            </button>
            <LanguageSwitcher />
          </div>
        </header>

        {exportError && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-red-600 text-sm">{exportError}</div>
        )}
        {docLoaded && deletedPages.has(doc.currentPage) && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 text-amber-700 text-sm">{t('app.pageDeleted')}</div>
        )}

        {/* Main area */}
        <main className="flex-1 overflow-auto flex items-start justify-center p-6 bg-gray-100">
          {doc.loading && <p className="text-gray-400 mt-20">{t('app.loadingDoc')}</p>}
          {doc.error && <p className="text-red-500 mt-20 max-w-md text-center">{doc.error}</p>}

          {!doc.loading && doc.totalPages === 0 && !doc.error && (
            <div className="text-center mt-20 text-gray-400">
              <p className="text-xl mb-2">{t('app.dropHere')}</p>
              <p className="text-sm">{t('app.formatsHint')}</p>
            </div>
          )}

          {!doc.loading && doc.pages[doc.currentPage] && (
            <div className="relative">
              <CanvasEditor
                key={`${doc.currentPage}-${editorKey}`}
                pageDataUrl={doc.pages[doc.currentPage]}
                pageWidth={pageDims.width}
                pageHeight={pageDims.height}
                imageUrl={sigs.imageUrl}
                initialLayers={layersByPageRef.current[doc.currentPage] || []}
                onLayersChange={handleLayersChange}
                onUndoStateChange={handleUndoStateChange}
              />
              {deletedPages.has(doc.currentPage) && (
                // Visual veil marking the page as excluded from export. Pointer
                // events pass through so the user can still inspect/adjust.
                <div className="absolute inset-0 bg-gray-500/25 flex items-start justify-center pt-10 pointer-events-none">
                  <span className="bg-red-600 text-white text-xs font-semibold px-3 py-1 rounded shadow">
                    {t('app.pageExcludedStamp')}
                  </span>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showHistory && (
        <HistoryModal history={history} onReopen={handleReopen} onClose={() => setShowHistory(false)} />
      )}
    </div>
  )
}
