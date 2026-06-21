# n8n + Qdrant + Camofox Browser Automation Stack 🚀

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Production-ready AI automation stack — n8n workflows, Qdrant vector search,
> **Camofox browser** with C++-level anti-detection for LinkedIn/Facebook (powered by
> Camoufox engine — a Firefox fork with undetectable fingerprint spoofing), and
> self-hosted image upload. All images pulled from registries — no local builds needed.

## 📖 Overview

A lightweight, self-hosted stack combining:

- **[n8n](https://n8n.io)** — workflow automation engine (400+ integrations)
- **[Qdrant](https://qdrant.tech)** — vector database for semantic search, RAG, and AI memory
- **[Camofox Browser](https://github.com/jo-inc/camofox-browser)** — anti-detection browser server powered by [Camoufox](https://camoufox.com) (Firefox fork with C++-level fingerprint spoofing). Bypasses Cloudflare, Akamai, DataDome, and LinkedIn/Facebook bot detection. REST API with persistent sessions, VNC, and proxy support.
- **[Image Upload API](https://hub.docker.com/r/mimnets/n8n-image-upload)** — self-hosted imgbb replacement for n8n image uploads

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  PostgreSQL  │◄────│     n8n      │────►│   Qdrant    │
│  (metadata)  │     │ (automation) │     │  (vectors)  │
└──────────────┘     └──────┬───────┘     └─────────────┘
      :5432                 │                   :6333
                            │
              ┌─────────────┼─────────────┐
              │             │             │
    ┌─────────┴────┐  ┌────┴──────────┐  │
    │  Camofox     │  │ Image Upload  │  │
    │  Browser     │  │ (REST, 8010)  │  │
    │ (REST, 9377) │  │ imgbb repl.   │  │
    │ VNC :6080    │  └───────────────┘  │
    └──────────────┘                     │
```

- **Camofox Browser** — Firefox-based (Camoufox) with C++ engine-level anti-detection. No JavaScript stealth patches that can be detected — the browser itself reports realistic fingerprints. Accessible snapshots (90% smaller than raw HTML) with stable element refs for reliable clicking/typing. Sessions auto-persist — log in once via VNC, reuse forever.
- **Image Upload API** — Single container. n8n uploads images via HTTP, gets back a public URL for downstream workflow steps.

## ✨ Key Advantages

| Feature | Typical Chromium Stealth | Camofox (Camoufox) |
|---------|------------------------|--------------------|
| Browser engine | Chromium (Playwright) | Firefox (Camoufox fork) |
| Anti-detection | JS-level stealth patches (detectable) | C++ engine-level patches (undetectable) |
| Fingerprint spoofing | WebDriver, plugins, canvas noise | WebGL, AudioContext, WebRTC, screen geometry, hardware concurrency |
| Session persistence | Manual save/load via API | Automatic — logged-in state survives browser restarts |
| Token efficiency | Raw HTML (large) | Accessibility snapshots (~90% smaller) |
| Element stability | CSS selectors (break on UI changes) | Stable refs (e1, e2, e3 — survive DOM changes) |
| Resource use | ~200MB+ idle | ~40MB idle |

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/mimnets/n8n-qdrant-starter.git
cd n8n-qdrant-starter

# 2. Create .env from the example
cp .env.example .env

# 3. Edit .env — add your API keys
nano .env

# 4. Start everything (all images pulled from registries)
docker compose up -d

# 5. Check all services are healthy
docker compose ps
```

| Access | URL |
|--------|-----|
| **n8n** | `http://localhost:5678` |
| **Camofox API** | `http://localhost:9377` |
| **Camofox VNC (browser live view)** | `http://localhost:6080/vnc.html` |
| **Qdrant Dashboard** | `http://localhost:6333/dashboard` |
| **Image Upload API** | `http://localhost:8010` |

## 🗄️ Services

| Service | Image | Port (host) | Health |
|---------|-------|-------------|--------|
| `postgres` | `postgres:16-alpine` | `5432` *(internal)* | ✅ healthcheck |
| `n8n` | `n8nio/n8n:latest` | `5678` | ✅ healthcheck |
| `qdrant` | `qdrant/qdrant:latest` | `6333` | ✅ |
| `camofox` | `ghcr.io/jo-inc/camofox-browser:latest` | `9377` (API), `6080` (VNC) | ✅ healthcheck |
| `image-upload` | `mimnets/n8n-image-upload:latest` | `8010` | ✅ healthcheck |

### Camofox Browser details

| Detail | Value |
|--------|-------|
| Registry | GitHub Container Registry (`ghcr.io`) |
| Image | `ghcr.io/jo-inc/camofox-browser:latest` |
| Engine | [Camoufox](https://camoufox.com) — Firefox fork with C++ anti-detection |
| Anti-detection | Binary-level patches — WebGL, AudioContext, WebRTC, navigator.hardwareConcurrency, screen geometry |
| API | REST — create tabs, get snapshots (accessibility tree), click by ref, type, screenshot, scroll |
| Sessions | Automatic per-user profile persistence (cookies + localStorage + IndexedDB) |
| VNC | noVNC web client on `:6080` |
| Proxy | Configurable with auto GeoIP locale/timezone/geolocation |
| Cookie import | Netscape-format cookie files for bootstrapping authenticated sessions |

## 🖥️ VNC — Interactive Login via noVNC

Camofox includes a VNC plugin — watch the browser live and interact manually to handle logins, 2FA, and CAPTCHAs.

### Access

Open in your browser:
```
http://<server-ip>:6080/vnc.html
```

### One-time LinkedIn login via VNC

```bash
# 1. Open a browser tab pointed at LinkedIn login
curl -X POST http://localhost:9377/tabs \
  -H "Content-Type: application/json" \
  -d '{"userId":"monir","sessionKey":"linkedin","url":"https://linkedin.com/login"}'

# 2. Open http://localhost:6080/vnc.html in your browser
#    → Log into LinkedIn manually (handle 2FA if needed)

# 3. The persistence plugin auto-saves your session.
#    Future Camofox API calls will reuse the authenticated state automatically.
```

To export the storage state manually:
```bash
curl http://localhost:9377/sessions/monir/storage_state
```

## 🔧 Camofox API Endpoints

### Health check
```bash
curl http://localhost:9377/health
```

### Create a tab (navigate to URL)
```bash
curl -X POST http://localhost:9377/tabs \
  -H "Content-Type: application/json" \
  -d '{"userId":"monir","sessionKey":"linkedin","url":"https://linkedin.com/feed"}'
```

### Get page snapshot (with element refs)
```bash
curl http://localhost:9377/tabs/{tabId}/snapshot
# Returns accessibility tree with stable references: e1, e2, e3...
```

### Click an element by ref
```bash
curl -X POST http://localhost:9377/tabs/{tabId}/click \
  -H "Content-Type: application/json" \
  -d '{"ref":"e3"}'
```

### Type into an element by ref
```bash
curl -X POST http://localhost:9377/tabs/{tabId}/type \
  -H "Content-Type: application/json" \
  -d '{"ref":"e8","text":"Your post content"}'
```

### Screenshot
```bash
curl http://localhost:9377/tabs/{tabId}/screenshot
```

### Import cookies (from Netscape-format file)
```bash
curl -X POST http://localhost:9377/sessions/monir/cookies \
  -H "Authorization: Bearer ${CAMOFOX_API_KEY}" \
  -d '{"cookies":[{"name":"session","value":"...","domain":".linkedin.com","path":"/"}]}'
```

### Close session
```bash
curl -X DELETE http://localhost:9377/sessions/monir
```

Full OpenAPI docs at `http://localhost:9377/docs` once running.

## 🖼️ Image Upload API

Self-hosted replacement for imgbb. n8n uploads an image, gets back a URL.

### From n8n workflows

```
POST http://image-upload:8001/upload
Body Type: Form-Data
  → file: {{ $json.binaryPropertyName }}  (mode: "From Binary Property")
```

### All endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/admin` | optional | Web-based admin panel |
| `POST` | `/upload` | optional | Upload an image (multipart/form-data) |
| `GET` | `/images/{filename}` | no | Serve an uploaded image |
| `GET` | `/images` | yes | List all uploaded images (JSON) |
| `DELETE` | `/images/{filename}` | yes | Delete an uploaded image |

## 🤖 n8n Workflow Patterns

### Step-by-step: Post to LinkedIn (no AI needed)

Instead of an AI agent that "sees" the page, Camofox uses stable element refs — chain HTTP nodes for precise control:

```
1. HTTP Request → POST http://camofox:9377/tabs
   Body: { "userId": "monir", "sessionKey": "linkedin", "url": "https://linkedin.com/feed" }
   → Gets tabId and session

2. HTTP Request → GET http://camofox:9377/tabs/{tabId}/snapshot
   → Returns accessibility tree with refs (e.g. "Start a post" button = ref "e3")

3. HTTP Request → POST http://camofox:9377/tabs/{tabId}/click
   Body: { "ref": "e3" }
   → Clicks "Start a post"

4. Wait 2s (NoOp node)

5. HTTP Request → GET http://camofox:9377/tabs/{tabId}/snapshot
   → Find the textbox ref

6. HTTP Request → POST http://camofox:9377/tabs/{tabId}/type
   Body: { "ref": "e8", "text": "Your post content goes here" }
   → Types into the composer

7. HTTP Request → GET http://camofox:9377/tabs/{tabId}/snapshot
   → Find the "Post" button ref

8. HTTP Request → POST http://camofox:9377/tabs/{tabId}/click
   Body: { "ref": "e12" }
   → Submits the post

9. HTTP Request → DELETE http://camofox:9377/tabs/{tabId}
   → Clean up
```

### Test: Check if session is active

```
1. HTTP Request → POST http://camofox:9377/tabs
   Body: { "userId": "monir", "sessionKey": "linkedin", "url": "https://linkedin.com/feed" }

2. HTTP Request → GET http://camofox:9377/tabs/{tabId}/snapshot

3. Code node:
   const snapshot = $input.first().json;
   const text = JSON.stringify(snapshot);
   if (text.includes("Start a post") || text.includes("My Network")) {
     return { loggedIn: true };
   }
   return { loggedIn: false, message: "Log in via VNC first" };
```

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **camofox unhealthy** | `docker compose logs camofox` — check for Camoufox download errors |
| **VNC shows blank screen** | Ensure `ENABLE_VNC=true` is set in environment |
| **n8n can't reach camofox** | Use `http://camofox:9377` (Docker network name, not localhost) |
| **Session not persisting** | The persistence plugin saves automatically on session close. Log in via VNC first |
| **Port already in use** | Change host ports in `docker-compose.yml` |
| **Image Upload admin not working** | Hard refresh: **Ctrl+Shift+R** |

## 🔒 Security Notes

- **Change all default passwords** in `.env` before production use
- Set strong `N8N_ENCRYPTION_KEY` and `N8N_USER_MANAGEMENT_JWT_SECRET`
- Generate a `CAMOFOX_API_KEY` with `openssl rand -hex 32`
- Use a reverse proxy (nginx, Caddy) with HTTPS for production
- Never commit `.env` (it's gitignored)
- Set `UPLOAD_API_KEY` if image-upload port is exposed publicly

## ☁️ Deployment

```bash
git clone https://github.com/mimnets/n8n-qdrant-starter.git
cd n8n-qdrant-starter
cp .env.example .env
nano .env
docker compose up -d
```

### Update

```bash
git pull
docker compose pull
docker compose up -d
```

### Firewall (OCI / AWS / GCP)

| Port | Service |
|------|---------|
| `5678` | n8n web UI |
| `6080` | noVNC (Camofox browser live view) |
| `9377` | Camofox REST API |
| `8010` | Image Upload API + admin panel |
| `6333` | Qdrant (internal only recommended) |

## 📁 Project Structure

```
n8n-qdrant-starter/
├── .env.example              # Environment template
├── docker-compose.yml        # All services
├── README.md
├── LICENSE                   # MIT
├── scripts/
│   ├── n8n-entrypoint.sh
│   ├── setup.sh
│   └── backup.sh
└── image-upload-server/      # Source for the image-upload Docker image
```

## 📚 Additional Resources

- [Camofox Browser GitHub](https://github.com/jo-inc/camofox-browser) — Full docs, API reference, deployment options
- [Camoufox](https://camoufox.com) — The Firefox fork with C++ anti-detection
- [n8n](https://docs.n8n.io) — Workflow automation documentation
- [Qdrant](https://qdrant.tech/documentation/) — Vector database docs
