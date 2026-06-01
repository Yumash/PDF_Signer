// @vitest-environment node
//
// Run under Node (not jsdom): demoStore is DOM-independent, and Node's global
// Blob survives structuredClone (which fake-indexeddb uses to persist records),
// whereas jsdom's Blob clones to {} and would lose the bytes. The object-URL
// API is stubbed below since Node has no URL.createObjectURL.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'

// demoStore caches a single DB connection at module level, so reset both the
// fake IndexedDB factory AND the module registry before each test for isolation.
// jsdom lacks URL.createObjectURL, so stub the object-URL lifecycle too.
let store

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory()
  globalThis.URL.createObjectURL = vi.fn(() => `blob:mock/${Math.random()}`)
  globalThis.URL.revokeObjectURL = vi.fn()
  vi.resetModules()
  store = await import('../demoStore')
})

describe('demoStore — signatures', () => {
  it('round-trips a signature blob (put/list/get/rename/delete)', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })
    await store.putSignature({ id: 'a', name: 'Sig A', blob })

    const list = await store.listSignatures()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'a', name: 'Sig A' })

    const got = await store.getSignature('a')
    expect(got.blob).toBeInstanceOf(Blob)

    expect(await store.renameSignature('a', 'Renamed')).toBe('Renamed')
    expect((await store.getSignature('a')).name).toBe('Renamed')

    await store.deleteSignature('a')
    expect(await store.listSignatures()).toEqual([])
  })

  it('renameSignature returns null for an unknown id', async () => {
    expect(await store.renameSignature('missing', 'x')).toBeNull()
  })

  it('deleting a missing signature is a no-op (no throw)', async () => {
    await expect(store.deleteSignature('nope')).resolves.toBeUndefined()
  })

  it('lists signatures oldest first', async () => {
    await store.putSignature({ id: 'old', blob: new Blob(['x']), createdAt: 1 })
    await store.putSignature({ id: 'new', blob: new Blob(['y']), createdAt: 2 })
    expect((await store.listSignatures()).map((s) => s.id)).toEqual(['old', 'new'])
  })
})

describe('demoStore — history', () => {
  it('round-trips entries newest first; summary omits blobs', async () => {
    const ob = new Blob(['o'])
    const rb = new Blob(['r'])
    await store.putHistoryEntry({
      id: '1', filename: 'a.pdf', ext: 'pdf', page_count: 1,
      originalBlob: ob, resultBlob: rb, pages: [{ page_idx: 0 }],
      delete_pages: [], created_at: '2026-01-01T00:00:00Z',
    })
    await store.putHistoryEntry({
      id: '2', filename: 'b.pdf', ext: 'pdf', page_count: 2,
      originalBlob: ob, resultBlob: rb, pages: [], delete_pages: [],
      created_at: '2026-02-01T00:00:00Z',
    })

    const list = await store.listHistoryEntries()
    expect(list.map((e) => e.id)).toEqual(['2', '1']) // newest first
    expect(list[0].originalBlob).toBeUndefined() // summary is blob-free

    const full = await store.getHistoryEntry('1')
    expect(full.pages).toEqual([{ page_idx: 0 }])
    expect(full.originalBlob).toBeInstanceOf(Blob)

    await store.deleteHistoryEntries(['1', '2'])
    expect(await store.listHistoryEntries()).toEqual([])
  })

  it('deleteHistoryEntry on a missing id is a no-op', async () => {
    await expect(store.deleteHistoryEntry('gone')).resolves.toBeUndefined()
  })
})

describe('demoStore — object URLs & ids', () => {
  it('caches object URLs per id and revokes them', async () => {
    const blob = new Blob(['x'])
    const u1 = store.objectUrlFor('k', blob)
    const u2 = store.objectUrlFor('k', blob)
    expect(u1).toBe(u2) // cached
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)

    store.revokeObjectUrl('k')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(u1)

    const u3 = store.objectUrlFor('k', blob)
    expect(u3).not.toBe(u1) // re-minted after revoke
  })

  it('newId returns unique strings', () => {
    expect(store.newId()).not.toBe(store.newId())
    expect(typeof store.newId()).toBe('string')
  })
})
