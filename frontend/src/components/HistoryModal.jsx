import { useState, useEffect } from 'react'
import { useI18n } from '../i18n/index.jsx'
import { saveBlob } from '../lib/download'

// Format an ISO timestamp for display; fall back to the raw string if Date can't
// parse it (never throw inside render).
function formatDate(iso) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

// Signing-history panel: list of past exports with checkbox multi-select. Each
// entry can be reopened for editing (restores the original + placed signatures),
// downloaded, or deleted. The toolbar deletes all selected entries at once.
export function HistoryModal({ history, onReopen, onClose }) {
  const { t } = useI18n()
  const { entries, loading, error, reload, remove, removeMany, getResultBlob } = history
  const [selected, setSelected] = useState(() => new Set())
  const [dlError, setDlError] = useState(null)

  // Save a past result via the native dialog (Tauri) or anchor download (web).
  const handleDownload = async (entry) => {
    setDlError(null)
    try {
      const blob = await getResultBlob(entry.id)
      if (blob) await saveBlob(`signed.${entry.ext || 'pdf'}`, blob)
    } catch (e) {
      setDlError(e.message)
    }
  }

  // Refresh on open so a just-finished export shows up.
  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const allSelected = entries.length > 0 && selected.size === entries.length
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(entries.map((e) => e.id)))

  const deleteSelected = async () => {
    if (selected.size === 0) return
    await removeMany([...selected])
    setSelected(new Set())
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <h2 className="font-semibold text-gray-800">{t('history.title')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none px-1"
            aria-label={t('about.close')}
          >
            ✕
          </button>
        </div>

        {/* Toolbar: select-all + bulk delete */}
        {entries.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2 border-b bg-gray-50 text-sm">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span className="text-gray-600">{t('history.selectAll')}</span>
            </label>
            <button
              onClick={deleteSelected}
              disabled={selected.size === 0}
              className="ml-auto px-3 py-1 rounded border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {t('history.deleteSelected')} {selected.size > 0 ? `(${selected.size})` : ''}
            </button>
          </div>
        )}

        {dlError && <p className="px-5 py-2 text-red-500 text-sm border-b">{dlError}</p>}

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="px-5 py-4 text-gray-400">{t('app.loadingDoc')}</p>}
          {error && <p className="px-5 py-4 text-red-500">{error}</p>}
          {!loading && !error && entries.length === 0 && (
            <p className="px-5 py-6 text-gray-400 italic text-center">{t('history.empty')}</p>
          )}

          {entries.map((e) => (
            <div
              key={e.id}
              className={`flex items-center gap-3 px-5 py-2.5 border-b text-sm ${selected.has(e.id) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
            >
              <input
                type="checkbox"
                checked={selected.has(e.id)}
                onChange={() => toggle(e.id)}
                aria-label={t('app.select')}
              />
              <div className="flex-1 min-w-0">
                <div className="text-gray-800 truncate">{e.filename}</div>
                <div className="text-gray-400 text-xs">
                  {formatDate(e.created_at)} · {t('history.pages', { n: e.page_count })} · {(e.ext || '').toUpperCase()}
                </div>
              </div>
              <button
                onClick={() => onReopen(e.id)}
                className="px-2.5 py-1 rounded border text-blue-600 border-blue-200 hover:bg-blue-50"
              >
                {t('history.reopen')}
              </button>
              <button
                onClick={() => handleDownload(e)}
                className="px-2.5 py-1 rounded border text-gray-600 hover:bg-gray-100"
              >
                {t('history.download')}
              </button>
              <button
                onClick={() => remove(e.id)}
                title={t('props.delete')}
                aria-label={t('props.delete')}
                className="px-1.5 text-red-400 hover:text-red-600"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
