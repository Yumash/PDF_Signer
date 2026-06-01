import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BackendError } from './components/BackendError.jsx'
import { I18nProvider } from './i18n/index.jsx'
import { resolveApiBase, waitForBackend, inTauri } from './constants'
import { resolveConfig } from './lib/config'

// Create the root once; boot() re-renders into it on retry.
const root = createRoot(document.getElementById('root'))

const render = (child) =>
  root.render(
    <StrictMode>
      <I18nProvider>{child}</I18nProvider>
    </StrictMode>,
  )

// Resolve the sidecar's dynamic port (Tauri) and wait for it to answer /health
// before mounting, so the first requests target a live origin. In the
// browser/Docker build there's no sidecar to wait on (nginx serves the API
// same-origin), so we skip the poll and mount immediately. On Tauri startup
// failure we mount a blocking error screen instead of a silently-broken UI.
async function boot() {
  await resolveApiBase()
  // Learn the server mode (demo vs normal) before mounting so hooks branch
  // correctly on first render. Never throws — defaults to normal mode.
  await resolveConfig()
  const ready = inTauri() ? await waitForBackend() : true
  render(ready ? <App /> : <BackendError onRetry={boot} />)
}

boot()
