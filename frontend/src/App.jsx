import { useState, useRef, useCallback } from 'react'
import './index.css'
import { useDocument } from './hooks/useDocument'
import { useSignatures } from './hooks/useSignatures'
import { CanvasEditor } from './components/CanvasEditor'

const ALLOWED = '.pdf,.jpg,.jpeg,.png,.tiff,.tif,.webp'

const CHECKER = {
  backgroundImage: `linear-gradient(45deg,#ccc 25%,transparent 25%),
    linear-gradient(-45deg,#ccc 25%,transparent 25%),
    linear-gradient(45deg,transparent 75%,#ccc 75%),
    linear-gradient(-45deg,transparent 75%,#ccc 75%)`,
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0,0 4px,4px -4px,-4px 0',
}

export default function App() {
  const doc = useDocument()
  const sigs = useSignatures()
  const [mode, setMode] = useState('view')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [removeBg, setRemoveBg] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [sigError, setSigError] = useState(null)
  const canvasLayersRef = useRef([])
  const sourceFileRef = useRef(null)
  const sigInputRef = useRef(null)

  const handleFileInput = (e) => {
    const f = e.target.files?.[0]
    if (f) { sourceFileRef.current = f; doc.loadFile(f); setMode('view') }
  }
  const handleDrop = (e) => {
    e.preventDefault()
    // Ignore drops that came from the signature library (CanvasEditor stops propagation,
    // but guard here too in case the drop lands outside the canvas area)
    if (e.dataTransfer.types.includes('application/signature')) return
    const f = e.dataTransfer?.files?.[0]
    if (f) { sourceFileRef.current = f; doc.loadFile(f); setMode('view') }
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
    canvasLayersRef.current = layers
  }, [])

  const handleExport = async () => {
    if (!sourceFileRef.current) return
    setExporting(true)
    setExportError(null)
    try {
      const layers = canvasLayersRef.current
      const pagesPayload = layers.length > 0
        ? [{ page_idx: doc.currentPage, signatures: layers.map((l) => ({
            id: l.sigId, x: l.x, y: l.y, w: l.width, h: l.height,
            angle: l.rotation, opacity: l.opacity,
          })) }]
        : [{ page_idx: doc.currentPage, signatures: [] }]

      const form = new FormData()
      form.append('file', sourceFileRef.current)
      form.append('pages', JSON.stringify(pagesPayload))

      const res = await fetch('/api/export', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || 'Export failed')
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'signed.' + (sourceFileRef.current.name.endsWith('.pdf') ? 'pdf' : 'jpg')
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setExportError(e.message)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-100" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>

      {/* Left: Signature Library */}
      <aside className="w-56 bg-white border-r flex flex-col text-xs">
        <div className="px-3 py-2 border-b font-semibold text-gray-700">Подписи</div>

        {/* Step 1 — toggle bg removal */}
        <div className="px-3 pt-2 pb-1">
          <p className="text-gray-400 mb-1">Шаг 1 — настройки загрузки</p>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setRemoveBg(v => !v)}
              className={`w-8 h-4 rounded-full transition-colors flex-shrink-0 relative ${removeBg ? 'bg-blue-500' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${removeBg ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </div>
            <span className={removeBg ? 'text-blue-600 font-medium' : 'text-gray-400'}>
              Удалить фон
            </span>
          </label>
          {removeBg && <p className="text-gray-400 mt-0.5 ml-10">rembg · ИИ-удаление</p>}
        </div>

        {/* Step 2 — upload */}
        <div className="px-3 pb-2">
          <p className="text-gray-400 mb-1">Шаг 2 — загрузи подпись</p>
          <button
            onClick={() => sigInputRef.current?.click()}
            disabled={uploading}
            className="w-full border-2 border-dashed border-gray-300 rounded p-2 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors disabled:opacity-50 text-center"
          >
            {uploading ? '⏳ Обработка…' : '+ Загрузить подпись'}
          </button>
          <input ref={sigInputRef} type="file" accept=".jpg,.jpeg,.png,.tiff,.tif,.webp" onChange={handleSigUpload} className="hidden" />
          {sigError && <p className="text-red-500 mt-1">{sigError}</p>}
        </div>

        <div className="px-3 pb-1 border-t pt-2">
          <p className="text-gray-400">Шаг 3 — перетащи на документ</p>
        </div>

        {/* Signatures list */}
        <div className="flex-1 overflow-y-auto">
          {sigs.signatures.map((sig) => (
            <div key={sig.id}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('application/signature', JSON.stringify(sig))}
              title="Перетащи на документ"
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
            <p className="px-3 py-2 text-gray-400 italic">Нет сохранённых подписей</p>
          )}
        </div>
      </aside>

      {/* Center */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <header className="flex items-center gap-2 px-4 py-2 bg-white border-b shadow-sm text-sm flex-shrink-0">
          <label className="cursor-pointer bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 text-sm">
            Открыть документ
            <input type="file" accept={ALLOWED} onChange={handleFileInput} className="hidden" />
          </label>

          {doc.totalPages > 0 && (
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
                <button onClick={() => setMode(mode === 'sign' ? 'view' : 'sign')}
                  className={`px-3 py-1 rounded text-sm ${mode === 'sign' ? 'bg-green-600 text-white' : 'border hover:bg-gray-100'}`}>
                  {mode === 'sign' ? '✎ Режим подписи' : 'Разместить свою подпись'}
                </button>
                {mode === 'sign' && (
                  <button onClick={handleExport} disabled={exporting}
                    className="px-3 py-1 rounded text-sm bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-50">
                    {exporting ? 'Экспорт…' : '💾 Вставить и сохранить'}
                  </button>
                )}
              </div>
            </>
          )}
        </header>

        {exportError && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-red-600 text-sm">{exportError}</div>
        )}

        {/* Main area */}
        <main className="flex-1 overflow-auto flex items-start justify-center p-6 bg-gray-100">
          {doc.loading && <p className="text-gray-400 mt-20">Загрузка документа…</p>}
          {doc.error && <p className="text-red-500 mt-20 max-w-md text-center">{doc.error}</p>}

          {!doc.loading && doc.totalPages === 0 && !doc.error && (
            <div className="text-center mt-20 text-gray-400">
              <p className="text-xl mb-2">Перетащите документ сюда</p>
              <p className="text-sm">PDF, JPG, PNG, TIFF, WEBP · до 50 МБ</p>
            </div>
          )}

          {!doc.loading && doc.pages[doc.currentPage] && mode === 'view' && (
            <img src={doc.pages[doc.currentPage]} alt="page"
              className="shadow-lg bg-white max-w-full"
              style={{ width: `${doc.scale * 100}%`, height: 'auto' }} />
          )}

          {!doc.loading && doc.pages[doc.currentPage] && mode === 'sign' && (
            <CanvasEditor
              pageDataUrl={doc.pages[doc.currentPage]}
              pageWidth={794}
              pageHeight={1123}
              imageUrl={sigs.imageUrl}
              onLayersChange={handleLayersChange}
            />
          )}
        </main>
      </div>
    </div>
  )
}
