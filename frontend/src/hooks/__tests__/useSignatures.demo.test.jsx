import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { I18nProvider } from '../../i18n/index.jsx'

// Force demo mode and mock the browser store so the hook's demo branch is
// exercised without a real IndexedDB.
vi.mock('../../lib/config', () => ({ isDemoMode: () => true }))

const store = vi.hoisted(() => ({
  putSignature: vi.fn(() => Promise.resolve()),
  listSignatures: vi.fn(() => Promise.resolve([])),
  getSignature: vi.fn(),
  deleteSignature: vi.fn(() => Promise.resolve()),
  renameSignature: vi.fn(() => Promise.resolve('n')),
  objectUrlFor: vi.fn((id) => `blob:${id}`),
  revokeObjectUrl: vi.fn(),
  revokeAllObjectUrls: vi.fn(),
  isQuotaError: (e) => e?.name === 'QuotaExceededError',
}))
vi.mock('../../lib/demoStore', () => store)

const { useSignatures } = await import('../useSignatures')

const wrapper = ({ children }) => <I18nProvider>{children}</I18nProvider>
const res = (ok, body) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: () => Promise.resolve(body) })
const pngFile = () => new File(['x'], 'sig.png', { type: 'image/png' })

beforeEach(() => {
  store.listSignatures.mockResolvedValue([])
  store.putSignature.mockClear()
  globalThis.fetch = vi.fn(() => res(true, {}))
})

describe('useSignatures (demo mode)', () => {
  it('stores the uploaded signature blob in the browser store', async () => {
    globalThis.fetch = vi.fn((url, opts) =>
      opts?.method === 'POST'
        ? res(true, { id: 'd1', name: 'Sig', image: 'data:image/png;base64,AAAA' })
        : res(true, []),
    )
    store.listSignatures.mockResolvedValue([{ id: 'd1', name: 'Sig', blob: new Blob(['x']) }])

    const { result } = renderHook(() => useSignatures(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let out
    await act(async () => {
      out = await result.current.upload(pngFile(), true)
    })
    expect(out.id).toBe('d1')
    expect(store.putSignature).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'd1', name: 'Sig' }),
    )

    // imageUrl resolves from the store object-URL map, not /api/signatures.
    await waitFor(() => expect(result.current.signatures).toHaveLength(1))
    expect(result.current.imageUrl('d1')).toBe('blob:d1')
  })

  it('getSignatureData returns {id: dataURL} read from the store', async () => {
    store.getSignature.mockResolvedValue({
      id: 'd1',
      blob: new Blob(['hello'], { type: 'image/png' }),
    })
    const { result } = renderHook(() => useSignatures(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let data
    await act(async () => {
      data = await result.current.getSignatureData(['d1'])
    })
    expect(Object.keys(data)).toEqual(['d1'])
    expect(data.d1).toMatch(/^data:.*base64,/)
  })

  it('surfaces a localized quota message when the store is full (M2)', async () => {
    globalThis.fetch = vi.fn((url, opts) =>
      opts?.method === 'POST'
        ? res(true, { id: 'd1', name: 'Sig', image: 'data:image/png;base64,AAAA' })
        : res(true, []),
    )
    store.putSignature.mockRejectedValueOnce(
      Object.assign(new Error('full'), { name: 'QuotaExceededError' }),
    )
    const { result } = renderHook(() => useSignatures(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(
      act(async () => {
        await result.current.upload(pngFile(), true)
      }),
    ).rejects.toThrow(/full|заполнено/i)
  })

  it('throws a clean error on a malformed base64 response (L1)', async () => {
    globalThis.fetch = vi.fn((url, opts) =>
      opts?.method === 'POST'
        ? res(true, { id: 'd1', name: 'Sig', image: 'data:image/png;base64,@@@' })
        : res(true, []),
    )
    const { result } = renderHook(() => useSignatures(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await expect(
      act(async () => {
        await result.current.upload(pngFile(), true)
      }),
    ).rejects.toThrow()
    expect(store.putSignature).not.toHaveBeenCalled()
  })

  it('never lists signatures from the server in demo mode', async () => {
    const fetchMock = vi.fn(() => res(true, {}))
    globalThis.fetch = fetchMock
    renderHook(() => useSignatures(), { wrapper })
    await waitFor(() => expect(store.listSignatures).toHaveBeenCalled())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
