# Public Demo Deployment

How to run PDF Signer as a **stateless public demo** — a deployment anyone can
use without registration, where **nothing they upload is stored on the server**.

> Looking for the normal, persistent deployment? That's just `docker compose up`
> — see the [README](../README.md#english). This guide is only for the public demo.

---

## What demo mode is (and isn't)

In demo mode (`DEMO_MODE=1`) the backend is **stateless**:

- Signature **background removal** still runs on the server, but the processed
  PNG is returned inline (base64) and **never written to disk**.
- The **signature library** and the **signing history** live only in the
  visitor's **browser** (IndexedDB). At export time the browser ships the
  signature pixels inline with the request; the server composes them in memory
  and keeps nothing.
- The signed file is produced and downloaded as usual — but **no server-side
  copy and no history entry** are saved.
- A **banner** is shown in the UI explaining that data stays in the browser.

| | Normal (`docker compose up`) | Demo (`-f docker-compose.demo.yml`) |
|---|---|---|
| Signatures stored on server | Yes (`/data/signatures`) | **No** |
| Signed-output copy on server | Yes (`/data/output`) | **No** |
| Signing history | Server (`/data/history`) | **Browser only (IndexedDB)** |
| Data volume mounted | Yes | **No** |
| Visitor isolation | Shared `/data` | **Full** (server holds nothing) |
| Banner | No | Yes |

**Not provided by demo mode:** there is **no authentication / login** — the demo
is intentionally open. Isolation between visitors comes from statelessness
(the server simply holds nothing), not from accounts. There is no built-in
rate-limiting beyond the anti-DoS caps below; add it at your reverse proxy if you
expose this publicly.

---

## Prerequisites

- **Docker** with **Docker Compose v2.24.4 or newer** — the demo override uses
  the `!reset` merge tag to drop the data volume, which older Compose ignores.
  Check with `docker compose version`.
- A host (a small VPS is plenty) and, for a public URL, a domain + TLS (below).

---

## Quick start

```bash
git clone https://github.com/TinaUma/PDF_Signer.git
cd PDF_Signer
docker compose -f docker-compose.yml -f docker-compose.demo.yml up --build -d
```

The app is served on **http://localhost:8080**. Stop it with:

```bash
docker compose -f docker-compose.yml -f docker-compose.demo.yml down
```

Both `-f` files are required: the base file defines the services, the demo file
layers `DEMO_MODE=1` on top and removes the data volume.

---

## Verify it really is in demo mode

1. **Config endpoint** — should report `demo_mode: true`:

   ```bash
   curl http://localhost:8080/api/config
   # {"demo_mode": true, "version": "1.1.0"}
   ```

2. **Banner** — the UI shows a "demo mode — data stays in your browser" strip.

3. **Resolved config** — confirm the backend has the flag and **no** data volume:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.demo.yml config
   # backend.environment has DEMO_MODE: "1"; backend has no `volumes:` mount
   ```

4. **Empty library on a fresh browser** — open the demo in a new private window;
   the signature library and history start empty (they're per-browser).

---

## Public hosting behind HTTPS (recommended)

The frontend container listens on **port 8080 over plain HTTP**. For a public
endpoint, terminate TLS at a reverse proxy in front of it and **do not** expose
the backend directly — the backend has no host port and is reachable only
through the frontend's internal nginx proxy on the Compose network.

**Caddy** (automatic HTTPS):

```caddy
demo.example.com {
    reverse_proxy localhost:8080
}
```

**nginx** (with your own certs / certbot):

```nginx
server {
    listen 443 ssl;
    server_name demo.example.com;

    ssl_certificate     /etc/letsencrypt/live/demo.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/demo.example.com/privkey.pem;

    client_max_body_size 50m;   # match the app's 50 MB upload limit

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

> The reference live demo runs this way at **https://tinacodes.space**.

If you only want the container reachable on the host's loopback (so the reverse
proxy is the sole entry point), bind the published port to `127.0.0.1` in a small
extra override, e.g. `ports: ["127.0.0.1:8080:8080"]` on the frontend service.

---

## Updating / redeploying

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.demo.yml up -d --build
```

Because the demo stores nothing server-side, redeploys carry no data-migration
concerns. Visitors' own libraries persist in their browsers across redeploys.

---

## Security & resource notes

- **No auth by design** — keep the demo free of anything sensitive; it is open to
  the public.
- **Anti-DoS caps** (enforced regardless of mode): uploads ≤ 50 MB; rasterised
  page area ≤ ~64 MP with a Pillow decompression-bomb guard; ≤ 500 pages; the
  inline `signatures_data` payload ≤ 900 KB (→ HTTP 413) and ≤ 100 unique
  signatures. For a public endpoint, add request rate-limiting at the reverse
  proxy.
- **Browser storage** — the library/history grow in the visitor's own IndexedDB.
  If their browser storage fills up, the app shows a friendly "storage full"
  message and the completed download is never affected.
- **Path safety** — inline signature ids are validated as UUIDs before use; a
  malformed or unknown id is skipped, not trusted as a path.

---

## Troubleshooting

**The banner doesn't appear / data still persists on the server.**
You are not actually in demo mode. Common causes:

- You ran plain `docker compose up`, or forgot the **second** `-f` file. Always
  pass both: `-f docker-compose.yml -f docker-compose.demo.yml`.
- Your **Docker Compose is older than v2.24.4**, so the `!reset` tag is ignored
  and the base data volume stays mounted. Upgrade Compose.

Diagnose:

```bash
# Should show DEMO_MODE: "1" and NO `source: data` volume under backend:
docker compose -f docker-compose.yml -f docker-compose.demo.yml config

# Should return demo_mode true:
curl http://localhost:8080/api/config
```

**The signature library is empty after reopening on another device/browser.**
That's expected — in demo mode the library and history are stored per-browser
(IndexedDB), so they do not follow the user across devices or survive clearing
site data.

**Uploads fail with 413.** The file exceeds 50 MB, or (in demo) the combined
inline signature data exceeds 900 KB — use fewer / smaller signatures.
