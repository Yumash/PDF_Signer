// Browser-owned persistence for demo mode. In a public demo the server stores
// nothing, so the signature library and the signing history live here in
// IndexedDB (blobs survive reloads; localStorage is too small for images).
//
// Two object stores, both keyed by `id`:
//   signatures: { id, name, blob, createdAt }
//   history:    { id, filename, ext, page_count, originalBlob, resultBlob,
//                 pages, delete_pages, created_at }

const DB_NAME = 'pdf-signer-demo'
const DB_VERSION = 1
const SIG_STORE = 'signatures'
const HIST_STORE = 'history'

// True for an IndexedDB "storage quota exceeded" failure, so callers can show a
// friendly message instead of a raw DOMException. Code 22 covers older engines
// that predate the named DOMException.
export function isQuotaError(err) {
  return !!err && (err.name === 'QuotaExceededError' || err.code === 22)
}

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SIG_STORE)) {
        db.createObjectStore(SIG_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(HIST_STORE)) {
        db.createObjectStore(HIST_STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function put(store, record) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite')
    t.objectStore(store).put(record)
    t.oncomplete = () => resolve(record)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

async function getAll(store) {
  const db = await openDb()
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll())
}

async function getOne(store, id) {
  const db = await openDb()
  return reqToPromise(db.transaction(store, 'readonly').objectStore(store).get(id))
}

// Deleting a missing key is a no-op in IndexedDB (the transaction still
// completes), so callers can delete freely without an existence check.
async function remove(store, id) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite')
    t.objectStore(store).delete(id)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

// --- Object-URL lifecycle ---------------------------------------------------
// Object URLs minted from stored blobs are cached per id so a signature renders
// with a stable src, and revoked on delete / unmount so they don't leak.
const urlCache = new Map()

export function objectUrlFor(id, blob) {
  const existing = urlCache.get(id)
  if (existing) return existing
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

export function revokeObjectUrl(id) {
  const url = urlCache.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(id)
  }
}

export function revokeAllObjectUrls() {
  for (const url of urlCache.values()) URL.revokeObjectURL(url)
  urlCache.clear()
}

// A unique id for a new browser-side record. Mirrors the server's uuid4 hex so
// is_valid_entry_id-style checks would accept it; falls back when crypto is
// unavailable (very old engines).
export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`
}

// --- Signatures -------------------------------------------------------------

export async function putSignature({ id, name, blob, createdAt }) {
  return put(SIG_STORE, {
    id,
    name: name || '',
    blob,
    createdAt: createdAt ?? Date.now(),
  })
}

// Oldest first, matching the server's sorted listing.
export async function listSignatures() {
  const all = await getAll(SIG_STORE)
  return all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function getSignature(id) {
  return getOne(SIG_STORE, id)
}

export async function deleteSignature(id) {
  revokeObjectUrl(id)
  return remove(SIG_STORE, id)
}

// Returns the stored name, or null if the id is unknown.
export async function renameSignature(id, name) {
  const rec = await getOne(SIG_STORE, id)
  if (!rec) return null
  rec.name = name || ''
  await put(SIG_STORE, rec)
  return rec.name
}

// --- History ----------------------------------------------------------------

export async function putHistoryEntry(entry) {
  return put(HIST_STORE, entry)
}

// Slim summary, newest first (mirrors history_service.list_entries).
export async function listHistoryEntries() {
  const all = await getAll(HIST_STORE)
  return all
    .map((e) => ({
      id: e.id,
      filename: e.filename,
      ext: e.ext,
      created_at: e.created_at,
      page_count: e.page_count ?? 0,
    }))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

export async function getHistoryEntry(id) {
  return getOne(HIST_STORE, id)
}

export async function deleteHistoryEntry(id) {
  return remove(HIST_STORE, id)
}

export async function deleteHistoryEntries(ids) {
  await Promise.all(ids.map((id) => remove(HIST_STORE, id)))
}
