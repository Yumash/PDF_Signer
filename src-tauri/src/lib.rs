use base64::Engine as _;
use std::net::TcpListener;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_shell::ShellExt;

// The TCP port the bundled FastAPI sidecar is listening on. Chosen dynamically
// at startup (see `pick_free_port`) and exposed to the webview via the
// `api_port` command so the frontend can build its API base URL.
struct ApiPort(u16);

// Frontend calls this (window.__TAURI__.core.invoke('api_port')) to learn which
// port the sidecar bound to, then talks to http://127.0.0.1:<port>.
#[tauri::command]
fn api_port(state: tauri::State<ApiPort>) -> u16 {
    state.0
}

// Open an external URL in the user's default browser. The webview CSP is
// `default-src 'self'`, so a plain <a href> can't navigate out; the frontend
// calls this for the GitHub link in the About dialog. Restricted to the project
// repository as defense-in-depth — the UI only ever passes that URL.
#[tauri::command]
fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // Exact repo URL or a path beneath it. A bare starts_with would also match
    // https://github.com/TinaUma/PDF_Signer.evil.com, so require the repo root
    // followed by nothing or a '/'.
    const REPO: &str = "https://github.com/TinaUma/PDF_Signer";
    if url != REPO && !url.starts_with(&format!("{REPO}/")) {
        return Err("blocked".into());
    }
    app.shell().open(url, None).map_err(|e| e.to_string())
}

// Save a file via a native OS dialog. The webview's HTML `<a download>` is a
// no-op in WebView2, so exports / history downloads round-trip the bytes here:
// the frontend sends base64, the user picks a path, and Rust writes it (full
// disk access — no fs-plugin scope needed). Returns false if the user cancels.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, default_name: String, b64: String) -> Result<bool, String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| e.to_string())?;
    let chosen = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .blocking_save_file();
    match chosen {
        Some(path) => {
            let pb = path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(&pb, &bytes).map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false), // user cancelled
    }
}

// Ask the OS for a free loopback port, then release it so the sidecar can bind.
// Hardcoding 8000 broke the app whenever something else already held it (e.g.
// another local service) — the sidecar failed to bind and every request became
// "failed to fetch". The brief gap between release here and bind in the sidecar
// is an accepted race for a localhost-only desktop tool. Falls back to 8000 if
// the OS query fails (no worse than the old behaviour).
fn pick_free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(8000)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port = pick_free_port();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ApiPort(port))
        .invoke_handler(tauri::generate_handler![api_port, open_external, save_file])
        .setup(move |app| {
            // Show the app version in the window title (e.g. "PDF Signer 1.1.0").
            // The static title in tauri.conf.json is just the fallback; setting it
            // here keeps it in lockstep with the real package version with no manual
            // edits. Best-effort — a missing window must not abort startup.
            let version = app.package_info().version.to_string();
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_title(&format!("PDF Signer {version}"));
            }

            // Per-user writable data dir (e.g. %APPDATA%\com.tinauuma.pdfsigner
            // on Windows, ~/Library/Application Support/... on macOS). User files
            // (signatures, exported docs) live here — NOT next to the exe — so
            // they stay writable regardless of install location (Program Files /
            // read-only .app) and never pollute the signed macOS bundle. Passed
            // to the sidecar via DATA_DIR; the backend's get_data_dir() honours it.
            let data_dir = app.path().app_data_dir().ok().map(|d| d.join("data"));
            if let Some(ref d) = data_dir {
                if let Err(e) = std::fs::create_dir_all(d) {
                    eprintln!("Failed to create data dir {}: {e}", d.display());
                }
            }

            // Start the bundled FastAPI sidecar on the chosen port. Failing to
            // start it must not crash the app (no .unwrap()/.expect()) — log and
            // continue so the window still opens with a clear error path.
            match app.shell().sidecar("api-server") {
                Ok(sidecar) => {
                    let mut sidecar = sidecar.env("PDF_SIGNER_PORT", port.to_string());
                    if let Some(ref d) = data_dir {
                        sidecar = sidecar.env("DATA_DIR", d.to_string_lossy().to_string());
                    }
                    if let Err(e) = sidecar.spawn() {
                        eprintln!("Failed to start API sidecar: {e}");
                    }
                }
                Err(e) => eprintln!("API sidecar not available: {e}"),
            }
            Ok(())
        })
        .on_window_event(|_window, event| {
            // Sidecar is auto-killed when all Tauri windows close
            if let tauri::WindowEvent::Destroyed = event {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
