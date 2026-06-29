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
- **[VidAPI](https://github.com/moshehbenavraham/vidapi)** — self-hosted video rendering via Editly + FFmpeg (async, queue-based)
- **[Kokoro TTS](https://github.com/remsky/Kokoro-FastAPI)** — text-to-speech with 35+ voices (OpenAI-compatible API)

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  PostgreSQL  │◄────│     n8n      │────►│   Qdrant    │
│  (metadata)  │     │ (automation) │     │  (vectors)  │
└──────────────┘     └──────┬───────┘     └─────────────┘
      :5432                 │                   :6333
                            │
              ┌─────────────┼──────────────────┐
              │             │                  │
    ┌─────────┴────┐  ┌────┴──────────┐       │
    │  Camofox     │  │ Image Upload  │       │
    │  Browser     │  │ (REST, 8010)  │       │
    │ (REST, 9377) │  │ imgbb repl.   │       │
    │ VNC :6080    │  └───────────────┘       │
    └──────────────┘                          │
                                              │
    ┌──────────────┐         ┌──────────────┐ │
    │  VidAPI      │         │  Kokoro TTS  │ │
    │  (REST,8089) │         │  (REST,8880) │ │
    │  Video       │         │  TTS/Speech  │ │
    │  Rendering   │         │  35+ voices  │ │
    └──────────────┘         └──────────────┘ │
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

# 5. Optional: Start supplementary services (video rendering + TTS)
docker compose -f docker-compose.vidapi.yml up -d

# 6. Check all services are healthy
docker compose ps
```

| Access | URL |
|--------|-----|
| **n8n** | `http://localhost:5678` |
| **Camofox API** | `http://localhost:9377` |
| **Camofox VNC (browser live view)** | `http://localhost:6080/vnc.html` |
| **Qdrant Dashboard** | `http://localhost:6333/dashboard` |
| **Image Upload API** | `http://localhost:8010` |
| **VidAPI (video rendering)** | `http://localhost:8089` |
| **VidAPI Swagger** | `http://localhost:8089/docs` |
| **Kokoro TTS** | `http://localhost:8880` |
| **Kokoro TTS Swagger** | `http://localhost:8880/docs` |
| **Kokoro TTS Web UI** | `http://localhost:8880/web` |

## 🗄️ Services

| Service | Image | Port (host) | Health |
|---------|-------|-------------|--------|
| `postgres` | `postgres:16-alpine` | `5432` *(internal)* | ✅ healthcheck |
| `n8n` | `n8nio/n8n:latest` | `5678` | ✅ healthcheck |
| `qdrant` | `qdrant/qdrant:latest` | `6333` | ✅ |
| `camofox` | `ghcr.io/jo-inc/camofox-browser:latest` | `9377` (API), `6080` (VNC) | ✅ healthcheck |
| `image-upload` | `mimnets/n8n-image-upload:latest` | `8010` | ✅ healthcheck |
| `vidapi-api` | *local build* — `vidapi/Dockerfile.api` | `8089` | ✅ healthcheck |
| `vidapi-worker` | *local build* — `vidapi/Dockerfile.worker` | *(internal)* | ✅ healthcheck |
| `vidapi-redis` | `redis:7-alpine` | *(internal)* | ✅ healthcheck |
| `kokoro-tts` | `ghcr.io/remsky/kokoro-fastapi-cpu:latest` | `8880` | ✅ healthcheck |

Web UI: `http://localhost:8089/docs` (VidAPI Swagger)

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

## 🎬 VidAPI — Self-Hosted Video Rendering

[![VidAPI](https://img.shields.io/badge/VidAPI-0.1.40-blue)](https://github.com/moshehbenavraham/vidapi)

VidAPI is a self-hosted video rendering service powered by [Editly](https://github.com/mifi/editly) — programmatic video editing with clips, images, text overlays, transitions, and audio. Integrates into workflows via REST API with async job queue (Redis + ARQ).

### Quick Start

```bash
cd n8n-qdrant-starter
docker compose -f docker-compose.vidapi.yml up -d
```

### Architecture

```
┌──────────────┐     ┌──────────────┐
│  HTTP POST   │────►│  vidapi-api  │
│ /v1/renders  │     │  (FastAPI)   │
└──────────────┘     └──────┬───────┘
      :8089                 │
                            ▼
                     ┌──────────────┐     ┌──────────────┐
                     │    Redis     │◄────│ vidapi-worker │
                     │   (queue)    │     │  (Editly +    │
                     └──────────────┘     │   FFmpeg)     │
                                           └──────┬───────┘
                                                   │
                                           ┌───────▼───────┐
                                           │   Rendered    │
                                           │    MP4/GIF    │
                                           └───────────────┘
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/health` | Health check |
| `POST` | `/v1/renders` | Submit a render job |
| `GET` | `/v1/renders` | List recent renders |
| `GET` | `/v1/renders/{id}` | Get render status |
| `GET` | `/v1/renders/{id}/download` | Download rendered video |
| `GET` | `/v1/renders/{id}/poster` | Download poster frame (JPEG) |
| `POST` | `/v1/templates` | Create reusable template |
| `POST` | `/v1/templates/{id}/renders` | Render from template |

Full Swagger docs at `http://localhost:8089/docs`.

### From n8n Workflows

**1. Submit a render**
```
POST http://vidapi-api:8000/v1/renders
Body (JSON):
{
  "renderer": "editly",
  "timeline": {
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "background": "#000000",
    "tracks": [
      {
        "clips": [
          {
            "asset": {"type": "color", "color": "#ff6666"},
            "length": 3,
            "fit": "cover"
          }
        ]
      }
    ]
  }
}
```
→ Returns a render ID

**2. Poll for status**
```
GET http://vidapi-api:8000/v1/renders/{render_id}
```
→ Status: `queued` → `rendering` → `succeeded`

**3. Download**
```
GET http://vidapi-api:8000/v1/renders/{render_id}/download
```
→ Returns MP4 file

### Supported Assets

| Type | Example |
|------|---------|
| `color` | `{"type": "color", "color": "#ff6666"}` |
| `image` | `{"type": "image", "src": "https://..."}` |
| `video` | `{"type": "video", "src": "https://...", "trim": 2.5}` |
| `text` | `{"type": "text", "text": "Hello", "font_size": 48}` |
| `audio` | `{"type": "audio", "src": "...", "volume": 0.8}` |

### Templates

Create reusable templates with variables for dynamic content:
```
POST /v1/templates
Body: { "name": "intro", "timeline": { ... } }
POST /v1/templates/{id}/renders
Body: { "variables": { "title": "My Video" } }
```

> **Note:** VidAPI uses its own composition schema (with `tracks` and `clips`), not raw Editly JSON5 format. The Editly renderer is selected automatically when no `renderer` is specified (or when set to `"editly"`).

---

## 🗣️ Kokoro TTS — Text-to-Speech

[![Kokoro FastAPI](https://img.shields.io/badge/Kokoro--FastAPI-5k%E2%98%85-brightgreen)](https://github.com/remsky/Kokoro-FastAPI)

Kokoro FastAPI is a Dockerized FastAPI wrapper for the [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) text-to-speech model. It provides an OpenAI-compatible API for multi-language speech synthesis with 35+ voices.

**Part of the supplementary services** (`docker-compose.vidapi.yml`):

```bash
docker compose -f docker-compose.vidapi.yml up -d kokoro-tts
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/audio/voices` | List available voices |
| `POST` | `/v1/audio/speech` | Generate speech (OpenAI-compatible) |
| `POST` | `/v1/audio/voices/combine` | Create weighted voice blend |
| `POST` | `/dev/captioned_speech` | Speech with word-level timestamps |

Swagger UI: `http://localhost:8880/docs`  \nWeb UI: `http://localhost:8880/web`

### From n8n Workflows

```
POST http://kokoro-tts:8880/v1/audio/speech
Content-Type: application/json
Body:
{
  "model": "kokoro",
  "input": "Your text to speak",
  "voice": "af_bella",
  "response_format": "mp3"
}
```
→ Returns the audio file (MP3, WAV, Opus, FLAC, or PCM)

**Available voices (35+):** `af_bella`, `af_sky`, `af_alloy`, `af_jessica`, `af_heart`, `af_nicole`, `af_aoede`, `af_kore`, `am_adam`, `am_michael`, `am_echo`, `am_eric`, `bf_emma`, `bm_george`, and more (English, Japanese, Chinese, Korean, French, Spanish, Italian, Portuguese, Hindi + blends).

**Voice blending:**
```json
{ "voice": "af_bella(2)+af_sky(1)", ... }
```
→ 67% Bella, 33% Sky

### Supported Output Formats

| Format | Content Type |
|--------|-------------|
| `mp3` | `audio/mpeg` |
| `wav` | `audio/wav` |
| `opus` | `audio/opus` |
| `flac` | `audio/flac` |
| `pcm` | `audio/pcm` (raw 24kHz 16-bit) |

---

## 🔗 Combining It All — Video + TTS Pipeline

A common workflow pattern: generate a voiceover with Kokoro TTS, then use the audio file as a soundtrack in VidAPI:

```
1. HTTP Request → POST http://kokoro-tts:8880/v1/audio/speech
   → Download the MP3 (voiceover)

2. Upload the MP3 somewhere accessible (or use image-upload)

3. HTTP Request → POST http://vidapi-api:8000/v1/renders
   Body: {
     "timeline": {
       "tracks": [{
         "clips": [{
           "asset": {"type": "video", "src": "..."},
           "length": 10
         }]
       }],
       "soundtrack": {"src": "<voiceover-url>"}
     }
   }
```

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
| `8089` | VidAPI video rendering API |
| `8880` | Kokoro TTS API |

## 📁 Project Structure

```
n8n-qdrant-starter/
├── .env.example              # Environment template
├── docker-compose.yml        # Core services (n8n, Qdrant, Camofox, image-upload)
├── docker-compose.vidapi.yml # Supplementary services (VidAPI, Kokoro TTS)
├── README.md
├── LICENSE                   # MIT
├── scripts/
│   ├── n8n-entrypoint.sh
│   ├── setup.sh
│   └── backup.sh
├── vidapi/                   # VidAPI source (built locally)
│   ├── Dockerfile.api
│   ├── Dockerfile.worker
│   ├── docker-compose.yml
│   └── ...
├── image-upload-server/      # Source for the image-upload Docker image
└── seleniumbase/             # SeleniumBase stealth browser
```

## 📚 Additional Resources

- [Camofox Browser GitHub](https://github.com/jo-inc/camofox-browser) — Full docs, API reference, deployment options
- [Camoufox](https://camoufox.com) — The Firefox fork with C++ anti-detection
- [n8n](https://docs.n8n.io) — Workflow automation documentation
- [Qdrant](https://qdrant.tech/documentation/) — Vector database docs
