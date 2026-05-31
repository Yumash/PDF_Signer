import { describe, it, expect } from 'vitest'
import { resolveApiError } from '../index.jsx'

// Fake t(): localizes a couple of known keys, returns the key otherwise
// (matching the real t() missing-key fallback that resolveApiError relies on).
const t = (key) => {
  const map = { 'error.corrupt_pdf': 'PDF повреждён', 'error.generic': 'Что-то пошло не так' }
  return map[key] ?? key
}

describe('resolveApiError', () => {
  it('maps a known code to a localized message', () => {
    expect(resolveApiError({ code: 'corrupt_pdf', message: 'x' }, t)).toBe('PDF повреждён')
  })

  it('falls back to the English message for an unknown code', () => {
    expect(resolveApiError({ code: 'nope', message: 'fallback msg' }, t)).toBe('fallback msg')
  })

  it('returns a plain-string detail as-is', () => {
    expect(resolveApiError('boom', t)).toBe('boom')
  })

  it('returns the generic message for undefined or a FastAPI validation list', () => {
    expect(resolveApiError(undefined, t)).toBe('Что-то пошло не так')
    expect(resolveApiError([{ loc: ['x'], msg: 'm' }], t)).toBe('Что-то пошло не так')
  })
})
