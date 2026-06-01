import { getApiBase } from '../constants'

// Runtime server config. The Docker frontend is a prebuilt static bundle and
// cannot read env vars at load time, so it asks the API at startup whether it
// is running as a stateless public demo. Resolved once by resolveConfig()
// (called from main.jsx before the app mounts) and then read synchronously via
// isDemoMode() — same module-state pattern as constants.getApiBase().
let demoMode = false
let resolved = false

// Fetch /api/config and latch the mode. Never throws: a network/parse failure
// keeps the safe default (normal, server-backed mode) so the app still renders
// and the user's data is never wrongly discarded.
export async function resolveConfig() {
  try {
    const res = await fetch(`${getApiBase()}/api/config`)
    if (res.ok) {
      const body = await res.json()
      demoMode = body?.demo_mode === true
    }
  } catch {
    /* stay in normal mode on any failure */
  } finally {
    resolved = true
  }
  return demoMode
}

// True only once resolveConfig() has confirmed the server is in demo mode.
export function isDemoMode() {
  return demoMode
}

// Whether resolveConfig() has run (mainly for tests/diagnostics).
export function isConfigResolved() {
  return resolved
}
