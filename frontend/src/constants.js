// A4 @ ~96dpi — fallback stage size when a page's real pixel size is unknown.
// Mirrors backend/constants.py (STAGE_FALLBACK_W/H); keep both in sync.
export const FALLBACK_DIMS = { width: 794, height: 1123 }

export const MAX_FILE_SIZE = 50 * 1024 * 1024  // 50 MB (mirror backend/nginx)
export const MIN_LAYER_SIZE = 20  // min signature width/height in px
export const DROP_MAX_WIDTH_FRACTION = 0.25  // dropped signature ≤ 25% of page width
export const PDF_RENDER_SCALE = 1.5  // pdf.js viewport scale for page rendering

// API origin. Empty = relative (Docker/browser: nginx proxies /api same-origin).
// Set VITE_API_BASE=http://localhost:8000 for the Tauri build, whose webview
// origin (tauri://localhost) can't reach the sidecar with a relative path.
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
