import { describe, it, expect, vi, afterEach } from 'vitest'

// config.js builds the URL from constants.getApiBase(); stub it to a relative
// base so we only exercise the fetch/latch logic.
vi.mock('../../constants', () => ({ getApiBase: () => '' }))

// demoMode is module-level state set by resolveConfig(); re-import fresh per
// test so one case can't leak its latched value into the next.
async function freshConfig() {
  vi.resetModules()
  return import('../config')
}

afterEach(() => {
  vi.restoreAllMocks()
  delete globalThis.fetch
})

describe('config / isDemoMode', () => {
  it('defaults to false before resolveConfig runs', async () => {
    const { isDemoMode, isConfigResolved } = await freshConfig()
    expect(isDemoMode()).toBe(false)
    expect(isConfigResolved()).toBe(false)
  })

  it('latches demo mode true when the server reports it', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ demo_mode: true, version: '1.1.0' }),
    })
    const { resolveConfig, isDemoMode, isConfigResolved } = await freshConfig()
    await resolveConfig()
    expect(isDemoMode()).toBe(true)
    expect(isConfigResolved()).toBe(true)
  })

  it('stays false on a non-ok (500) response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    const { resolveConfig, isDemoMode } = await freshConfig()
    await resolveConfig()
    expect(isDemoMode()).toBe(false)
  })

  it('stays false and never throws on a network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    const { resolveConfig, isDemoMode } = await freshConfig()
    await expect(resolveConfig()).resolves.toBe(false)
    expect(isDemoMode()).toBe(false)
  })

  it('treats a malformed body (no demo_mode) as false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ foo: 'bar' }),
    })
    const { resolveConfig, isDemoMode } = await freshConfig()
    await resolveConfig()
    expect(isDemoMode()).toBe(false)
  })
})
