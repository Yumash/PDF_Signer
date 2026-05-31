import { useState, useRef, useCallback, useEffect } from 'react'
import './index.css'
import { useDocument } from './hooks/useDocument'
import { useSignatures } from './hooks/useSignatures'
import { CanvasEditor } from './components/CanvasEditor'
import { LanguageSwitcher } from './i18n/LanguageSwitcher'
import { useI18n, resolveApiError } from './i18n/index.jsx'

const ALLOWED = '.pdf,.jpg,.jpeg,.png,.tiff,.tif,.webp'

const CHECKER = {
  backgroundImage: `linear-gradient(45deg,#ccc 25%,transparent 25%),
    linear-gradient(-45deg,#ccc 25%,transparent 25%),
    linear-gradient(45deg,transparent 75%,#ccc 75%),
    linear-gradient(-45deg,transparent 75%,#ccc 75%)`,
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0,0 4px,4px -4px,-4px 0',
}

const STEPS = [
  { n: 1, key: 'steps.open' },
  { n: 2, key: 'steps.upload' },
  { n: 3, key: 'steps.drag' },
  { n: 4, key: 'steps.save' },
]

export default function App() {
  const { t } = useI18n()
  const doc = useDocument()
  const sigs = useSignatures()
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [removeBg, setRemoveBg] = useState(true)
  const [jitter, setJitter] = useState(0)  // 0..100 — signature uniquification
  const [uploading, setUploading] = useState(false)
  const [sigError, setSigError] = useState(null)
  const [hasSigs, setHasSigs] = useState(false)
  const [deletedPages, setDeletedPages] = useState(() => new Set())  // pages excluded from export
  const layersByPageRef = useRef({})  // page index -> layer[]
  const [editorKey, setEditorKey] = useState(0)  // bump to remount the editor
  const sourceFileRef = useRef(null)
  const sigInputRef = useRef(null)
  const [undoState, setUndoState] = useState({ undo: null, redo: null, canUndo: false, canRedo: false })

  const handleUndoStateChange = useCallback((state) => setUndoState(state), [])

  // Reset per-page layers whenever a new document is loaded.
  useEffect(() => {
    layersByPageRef.current = {}
    setHasSigs(false)
    setDeletedPages(new Set())
  }, [doc.loadId])

  const toggleDeletePage = () => {
    setDeletedPages((prev) => {
      const next = new Set(prev)
      if (next.has(doc.currentPage)) next.delete(doc.currentPage)
      else next.add(doc.currentPage)
      return next
    })
  }

  const handleFileInput = (e) => {
    const f = e.target.files?.[0]
    if (f) { sourceFileRef.current = f; doc.loadFile(f) }
  }
  const handleDrop = (e) => {
    e.preventDefault()
    if (e.dataTransfer.types.includes('application/signature')) return
    const f = e.dataTransfer?.files?.[0]
    if (f) { sourceFileRef.current = f; doc.loadFile(f) }
  }

  const handleSigUpload = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    setSigError(null)
    setUploading(true)
    try { await sigs.upload(f, removeBg) } catch (err) { setSigError(err.message) }
    finally { setUploading(false); e.target.value = '' }
  }

  const handleLayersChange = useCallback((layers) => {
    layersByPageRef.current[doc.currentPage] = layers
    setHasSigs(Object.values(layersByPageRef.current).some((l) => l.length > 0))
  }, [doc.currentPage])

  // Copy the current page's signatures onto every page.
  const handleSignAll = () => {
    const cur = layersByPageRef.current[doc.currentPage] || []
    if (cur.length === 0) return
    for (let i = 0; i < doc.totalPages; i++) {
      if (deletedPages.has(i)) continue  // don't sign pages excluded from export
      // Unique id per (page, layer index) — avoids duplicate React keys when the
      // same signature appears more than once.
      layersByPageRef.current[i] = cur.map((l, j) => ({ ...l, id: `${l.sigId}-p${i}-${j}` }))
    }
    setHasSigs(true)
    setEditorKey((k) => k + 1)
  }

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
      const byPage = layersByPageRef.current
      const pagesPayload = Object.keys(byPage)
        .map(Number)
        .filter((idx) => byPage[idx] && byPage[idx].length > 0 && !deletedPages.has(idx))
        .map((idx) => {
          const dims = doc.pageDims[idx] || { width: 794, height: 1123 }
          return {
            page_idx: idx,
            stage_w: dims.width,
            stage_h: dims.height,
            jitter: jitter / 100,
            signatures: byPage[idx].map((l) => ({
              id: l.sigId, x: l.x, y: l.y, w: l.width, h: l.height,
              angle: l.rotation, opacity: l.opacity,
            })),
          }
        })
      if (pagesPayload.length === 0 && deletedPages.size === 0) return

      const form = new FormData()
      form.append('file', sourceFileRef.current)
      form.append('pages', JSON.stringify(pagesPayload))
      form.append('delete_pages', JSON.stringify([...deletedPages]))

      const res = await fetch('/api/export', { method: 'POST', body: form })
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
      URL.revokeObjectURL(url)
    } catch (e) {
      setExportError(e.message)
    } finally {
      setExporting(false)
    }
  }

  const docLoaded = doc.totalPages > 0
  // Real pixel size of the current page; the Konva stage and the export payload
  // both use it so the page aspect ratio is preserved (backend sx == sy).
  const pageDims = doc.pageDims[doc.currentPage] || { width: 794, height: 1123 }

  // Step progress: 1=open doc, 2=upload sig, 3=drag to doc, 4=export
  const step = !docLoaded ? 1 : sigs.signatures.length === 0 ? 2 : !hasSigs ? 3 : 4

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>

      {/* Left: Signature Library */}
      <aside className="w-56 bg-white border-r flex flex-col text-xs">
        <div className="px-3 py-2 border-b font-semibold text-gray-700">{t('app.signaturesTitle')}</div>

        {/* Step guide */}
        <div className="px-3 pt-2 pb-1 border-b">
          {STEPS.map(({ n, key }) => (
            <div key={n} className={`flex items-center gap-2 py-0.5 ${step === n ? 'text-blue-600 font-medium' : step > n ? 'text-gray-300 line-through' : 'text-gray-400'}`}>
              <span className={`w-4 h-4 rounded-full text-center leading-4 flex-shrink-0 text-[10px] ${step === n ? 'bg-blue-600 text-white' : step > n ? 'bg-gray-200 text-gray-400' : 'border border-gray-300 text-gray-400'}`}>{n}</span>
              <span>{t(key)}</span>
            </div>
          ))}
        </div>

        {/* Upload settings */}
        <div className="px-3 pt-2 pb-1">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setRemoveBg(v => !v)}
              className={`w-8 h-4 rounded-full transition-colors flex-shrink-0 relative ${removeBg ? 'bg-blue-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${removeBg ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className={removeBg ? 'text-blue-600 font-medium' : 'text-gray-400'}>
              {t('app.removeBg')}
            </span>
          </label>

          <label className="flex flex-col gap-0.5 mt-2" title={t('app.uniquifyHint')}>
            <span className={jitter > 0 ? 'text-blue-600 font-medium' : 'text-gray-400'}>
              {t('app.uniquify')} {jitter > 0 ? `${jitter}%` : ''}
            </span>
            <input type="range" min={0} max={100} value={jitter}
              onChange={(e) => setJitter(Number(e.target.value))}
              className="w-full" />
          </label>
        </div>

        {/* Upload button */}
        <div className="px-3 pb-2">
          <button
            onClick={() => sigInputRef.current?.click()}
            disabled={uploading}
            className="w-full border-2 border-dashed border-gray-300 rounded p-2 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50 text-center"
          >
            {uploading ? t('app.processing') : t('app.uploadSignature')}
          </button>
          <input ref={sigInputRef} type="file" accept=".jpg,.jpeg,.png,.tiff,.tif,.webp" onChange={handleSigUpload} className="hidden" />
          {sigError && <p className="text-red-500 mt-1">{sigError}</p>}
        </div>

        {/* Signatures list */}
        <div className="flex-1 overflow-y-auto border-t">
          {sigs.signatures.map((sig) => (
            <div key={sig.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/signature', JSON.stringify(sig))}
              title={t('app.dragToDoc')}
              className="flex items-center gap-2 px-2 py-1.5 hover:bg-blue-50 cursor-grab group"
            >
              <div style={CHECKER} className="w-14 h-8 rounded flex-shrink-0 flex items-center justify-center">
                <img src={sigs.imageUrl(sig.id)} alt="" className="w-14 h-8 object-contain" />
              </div>
              <span className="flex-1 text-gray-400 truncate">{sig.id.slice(0, 6)}…</span>
              <button onClick={() => sigs.remove(sig.id)} className="text-red-400 opacity-0 group-hover:opacity-100 px-1">✕</button>
            </div>
          ))}
          {!sigs.loading && sigs.signatures.length === 0 && (
            <p className="px-3 py-2 text-gray-400 italic">{t('app.noSignatures')}</p>
          )}
        </div>
      </aside>

      {/* Center */}
      <div className="flex-1 flex flex-col overflow-hidden">

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
                <span className="text-xs px-2">{doc.currentPage + 1} / {doc.totalPages}</span>
                <button onClick={() => doc.goTo(doc.currentPage + 1)} disabled={doc.currentPage === doc.totalPages - 1}
                  className="px-2 py-1 border rounded disabled:opacity-40 hover:bg-gray-100">›</button>
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
                  <button onClick={toggleDeletePage} title={t('app.deletePageHint')}
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
          <div className={docLoaded ? 'ml-2' : 'ml-auto'}>
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
          )}
        </main>
      </div>
    </div>
  )
}
