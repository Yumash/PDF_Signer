import { useState, useCallback, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useI18n } from '../i18n/index.jsx'
import { FALLBACK_DIMS, MAX_FILE_SIZE, PDF_RENDER_SCALE } from '../constants'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

const SUPPORTED_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
])
const SUPPORTED_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp'])

function getExt(name) {
  return name.slice(name.lastIndexOf('.')).toLowerCase()
}

function loadImageDims(url) {
  return new Promise((resolve) => {
    const img = new window.Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ ...FALLBACK_DIMS })
    img.src = url
  })
}

export function useDocument() {
  const { t } = useI18n()
  const [pages, setPages] = useState([])   // array of data URLs / object URLs
  const [pageDims, setPageDims] = useState([])  // real pixel size {width,height} per page
  const [loadId, setLoadId] = useState(0)  // bumps on every load — even same filename
  const [currentPage, setCurrentPage] = useState(0)
  const [scale, setScale] = useState(1.0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [fileName, setFileName] = useState(null)
  const objectUrlRef = useRef(null)  // revoke the previous image blob URL

  const loadFile = useCallback(async (file) => {
    setError(null)
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }

    if (file.size > MAX_FILE_SIZE) {
      setError(t('doc.tooBig', { size: (file.size / 1024 / 1024).toFixed(1) }))
      return
    }

    const ext = getExt(file.name)
    if (!SUPPORTED_EXTS.has(ext) && !SUPPORTED_TYPES.has(file.type)) {
      setError(t('doc.unsupported', { ext }))
      return
    }

    setLoading(true)
    setPages([])
    setPageDims([])
    setCurrentPage(0)
    setFileName(file.name)
    setLoadId((n) => n + 1)

    try {
      const arrayBuffer = await file.arrayBuffer()

      if (ext === '.pdf') {
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
        const rendered = []
        const dims = []
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i)
          const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
          rendered.push(canvas.toDataURL('image/png'))
          // Real rendered pixel size. Stage uses the same size, so the page
          // aspect ratio is preserved end-to-end and the backend's sx == sy
          // (no signature distortion on non-A4 pages).
          dims.push({ width: canvas.width, height: canvas.height })
        }
        setPages(rendered)
        setPageDims(dims)
      } else {
        const url = URL.createObjectURL(file)
        objectUrlRef.current = url
        const dim = await loadImageDims(url)
        setPages([url])
        setPageDims([dim])
      }
    } catch (e) {
      setError(t('doc.openError', { message: e.message }))
    } finally {
      setLoading(false)
    }
  }, [t])

  const goTo = useCallback((n) => {
    setCurrentPage(Math.max(0, Math.min(n, pages.length - 1)))
  }, [pages.length])

  return {
    pages, pageDims, loadId, currentPage, scale, loading, error, fileName,
    setScale, goTo, loadFile,
    totalPages: pages.length,
  }
}
