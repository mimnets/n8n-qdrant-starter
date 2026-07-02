# n8n + Qdrant + AI Automation Stack 🚀

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Production-ready AI automation stack — n8n workflows, Qdrant vector search,
> self-hosted file upload, video rendering with Ken Burns effects, and
> text-to-speech. All services in one `docker compose up`.

## 📖 Overview

A lightweight, self-hosted stack combining:

- **[n8n](https://n8n.io)** — workflow automation engine (400+ integrations)
- **[Qdrant](https://qdrant.tech)** — vector database for semantic search, RAG, and AI memory
- **[File Upload API](https://hub.docker.com/r/mimnets/n8n-file-upload)** — self-hosted file storage for images, audio, video, documents
- **[CutEngine](https://github.com/jjjames38/cutengine)** — self-hosted Shotstack-compatible video render engine with Ken Burns zoom effects, transitions, captions, and multi-track audio (async, queue-based)
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
    │ File Upload  │  │   CutEngine   │       │
    │ (REST, 8010) │  │ (REST, 3000)  │       │
    │  file store  │  │ Ken Burns +   │       │
    └──────────────┘  │  Captions     │       │
                      └───────┬───────┘       │
                              │               │
                              │         ┌─────┴──────┐
                              │         │ Kokoro TTS │
                              │         │ (REST,8880)│
                              │         │ TTS/Speech │
                              │         │ 35+ voices │
                              │         └────────────┘
                              ▼
                     ┌────────────────┐     ┌──────────────────┐
                     │    Redis       │◄────│   Chromium       │
                     │  (BullMQ)      │     │  (Puppeteer)     │
                     └────────────────┘     └──────────────────┘
```

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/mimnets/n8n-qdrant-starter.git
cd n8n-qdrant-starter

# 2. Create .env from the example
cp .env.example .env

# 3. Edit .env — add your API keys
nano .env

# 4. Start everything (builds CutEngine from local source)
docker compose up -d

# 5. Check all services are healthy
docker compose ps
```

| Access | URL |
|--------|-----|
| **n8n** | `http://localhost:5678` |
| **Qdrant Dashboard** | `http://localhost:6333/dashboard` |
| **File Upload API** | `http://localhost:8010` |
| **File Upload Admin** | `http://localhost:8010/admin` |
| **CutEngine API** | `http://localhost:3000` |
| **CutEngine Health** | `http://localhost:3000/health` |
| **Kokoro TTS** | `http://localhost:8880` |
| **Kokoro TTS Swagger** | `http://localhost:8880/docs` |
| **Kokoro TTS Web UI** | `http://localhost:8880/web` |

## 🗄️ Services

| Service | Image | Port (host) | Health |
|---------|-------|-------------|--------|
| `postgres` | `postgres:16-alpine` | `5432` *(internal)* | ✅ healthcheck |
| `n8n` | `n8nio/n8n:latest` | `5678` | ✅ healthcheck |
| `qdrant` | `qdrant/qdrant:latest` | `6333` | ✅ |
| `file-upload` | *local build* — `file-upload-server/Dockerfile` | `8010` | ✅ healthcheck |
| `cutengine` | *local build* — `cutengine/docker/Dockerfile` | `3000` | ✅ healthcheck |
| `cutengine-redis` | `redis:7-alpine` | *(internal)* | ✅ healthcheck |
| `cutengine-chromium` | `browserless/chrome:latest` | *(internal)* | ✅ healthcheck |
| `kokoro-tts` | `ghcr.io/remsky/kokoro-fastapi-cpu:latest` | `8880` | ✅ healthcheck |

**Note:** Some services (CutEngine, file-upload) are built from source locally. The first `docker compose up -d` will build these automatically.

## 📁 File Upload API

Self-hosted file storage for images, audio (mp3, wav, ogg, flac), video, documents, and archives.

### From n8n workflows

```
POST http://file-upload:8001/upload
Body Type: Form-Data
  → file: {{ $json.binaryPropertyName }}  (mode: "From Binary Property")
```

### All endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/admin` | optional | Web-based admin panel |
| `POST` | `/upload` | optional | Upload a file (multipart/form-data) |
| `GET` | `/files/{filename}` | no | Serve an uploaded file |
| `GET` | `/files` | yes | List all uploaded files (JSON) |
| `DELETE` | `/files/{filename}` | yes | Delete an uploaded file |

Legacy `/images/` endpoints also work for backward compatibility.

---

## 🎥 CutEngine — Video Rendering with Ken Burns Zoom

[![CutEngine](https://img.shields.io/badge/CutEngine-MIT-brightgreen)](https://github.com/jjjames38/cutengine)

CutEngine is a self-hosted, Shotstack v1 API-compatible video render engine powered by Puppeteer + FFmpeg. It supports **Ken Burns zoom effects** (`zoomIn`, `zoomOut`, `slideLeft`, `slideRight`), 20+ transitions, captions, text overlays, multi-track audio mixing, and hardware encoding (NVENC/VideoToolbox/QSV).

### Features

- **Ken Burns zoom effects** — per-frame computed transforms for smooth zooms/pans
- **Captions** — burnt-in subtitle overlays with font styling
- **20+ transitions** — fade, wipe, slide, carousel, shuffle, zoom, directional
- **14 asset types** — image, video, text, audio, shape, SVG, HTML, captions, and more
- **Shotstack API drop-in** — same JSON schema as Shotstack cloud API
- **Multi-track audio mixing** — TTS + background music with volume/fade/crossfade
- **Templates** — reusable templates with `{{PLACEHOLDER}}` merge fields
- **Batch rendering** — POST multiple renders in one request

### API Endpoints (Shotstack v1 Compatible)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (liveness) |
| `GET` | `/health?detail=1` | Detailed health |
| `POST` | `/edit/v1/render` | Submit a render job |
| `GET` | `/edit/v1/render/{id}` | Get render status |
| `GET` | `/serve/v1/assets/{id}/output.mp4` | Download rendered video |
| `POST` | `/x/v1/render/batch` | Batch render multiple jobs |
| `POST` | `/edit/v1/template` | Create reusable template |
| `POST` | `/edit/v1/template/{id}/render` | Render from template |
| `GET` | `/metrics` | Prometheus metrics |

### From n8n Workflows — Zoom + Audio + Captions

**1. Submit a render**

```
POST http://cutengine:3000/edit/v1/render
Body (JSON):
{
  "timeline": {
    "background": "#000000",
    "tracks": [
      {
        "clips": [{
          "asset": {
            "type": "image",
            "src": "{{ $('image-path').item.json.url }}"
          },
          "start": 0,
          "length": {{ $('audio-code').item.json.video_length }},
          "effect": "zoomIn"
        }]
      },
      {
        "clips": [{
          "asset": {
            "type": "audio",
            "src": "{{ $('audio-path').item.json.url }}"
          },
          "start": 0,
          "length": {{ $('audio-code').item.json.video_length }}
        }]
      },
      {
        "clips": [{
          "asset": {
            "type": "text",
            "text": "{{ $json.Voiceover_Text }}",
            "font": { "family": "Montserrat", "size": 48, "color": "#ffffff" },
            "stroke": { "color": "#000000", "width": 3 }
          },
          "start": 0,
          "length": {{ $('audio-code').item.json.video_length }},
          "position": "bottom",
          "offset": { "y": 0.09 }
        }]
      }
    ]
  },
  "output": { "format": "mp4", "resolution": "hd" }
}
```

→ Returns `{"success": true, "response": {"id": "abc123", "status": "queued"}}`

**2. Poll for status**

```
GET http://cutengine:3000/edit/v1/render/{id}
```
→ Status: `queued` → `rendering` → `done`

**3. Download**

```
GET http://cutengine:3000/serve/v1/assets/{id}/output.mp4
```

### Supported Ken Burns Effects

| Effect | Description |
|--------|-------------|
| `zoomIn` | Slow zoom into center |
| `zoomOut` | Slow zoom out from center |
| `slideLeft` | Pan from right to left |
| `slideRight` | Pan from left to right |
| `slideUp` | Pan from bottom to top |
| `slideDown` | Pan from top to bottom |
| `zoomInFast` | Fast zoom in |
| `zoomOutFast` | Fast zoom out |

### Supported Asset Types

| Type | Description |
|------|-------------|
| `image` | Image (JPEG, PNG, WebP) |
| `video` | Video file |
| `text` | Text overlay with font/stroke styling |
| `richText` | HTML-formatted text |
| `audio` | Audio file with volume/fade control |
| `shape` | Geometric shapes (rect, circle, triangle) |
| `svg` | Inline SVG |
| `html` | HTML/CSS rendered via Chromium |
| `title` | Animated title templates |
| `caption` | SRT/WebVTT caption overlays |

### Transitions

`fade`, `fadeSlow`, `fadeFast`, `reveal`, `wipe`, `slide`, `carousel`, `shuffle`, `zoom`, `directional_left`, `directional_right`, `directional_up`, `directional_down`, `circle_open`, `linear_blur`, and more.

### Filters

`blur`, `boost`, `contrast`, `darken`, `greyscale`, `lighten`, `muted`, `negative`

### Templates with Placeholders

**Create:**

```
POST http://cutengine:3000/edit/v1/template
Body:
{
  "name": "Reel Template",
  "template": {
    "timeline": {
      "tracks": [{
        "clips": [{
          "asset": { "type": "image", "src": "{{IMAGE_URL}}" },
          "start": 0, "length": 5,
          "effect": "zoomIn"
        }]
      }]
    },
    "output": { "format": "mp4", "resolution": "hd" }
  }
}
```

**Render with merge fields:**

```
POST http://cutengine:3000/edit/v1/template/{id}/render
Body:
{
  "merge": [{ "find": "IMAGE_URL", "replace": "https://..." }]
}
```

---

## 🗣️ Kokoro TTS — Text-to-Speech

[![Kokoro FastAPI](https://img.shields.io/badge/Kokoro--FastAPI-5k%E2%98%85-brightgreen)](https://github.com/remsky/Kokoro-FastAPI)

Kokoro FastAPI is a Dockerized FastAPI wrapper for the [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) text-to-speech model. OpenAI-compatible API with 35+ voices.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/audio/voices` | List available voices |
| `POST` | `/v1/audio/speech` | Generate speech (OpenAI-compatible) |
| `POST` | `/v1/audio/voices/combine` | Create weighted voice blend |
| `POST` | `/dev/captioned_speech` | Speech with word-level timestamps |

Swagger UI: `http://localhost:8880/docs`  \
Web UI: `http://localhost:8880/web`

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
→ Returns the audio file

**Voices:** `af_bella`, `af_sky`, `af_alloy`, `af_jessica`, `am_adam`, `am_michael`, `am_echo`, `bf_emma`, `bm_george`, and more (English, Japanese, Chinese, Korean, French, Spanish, Italian, Portuguese, Hindi + blends).

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
| `pcm` | `audio/pcm` |

---

## 🔗 Full Pipeline: Image → TTS → Video

A complete n8n workflow pattern:

```
1. Cloudflare Workers → Generate image (FLUX)
2. Code node → Convert to binary
3. File Upload API → Upload image, get URL
4. Kokoro TTS → Generate voiceover, upload audio
5. CutEngine → Submit render with image + audio + captions + zoom
6. Poll render status → Download final MP4
```

---

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **CutEngine build fails** | Check that `cutengine/` directory exists with source files |
| **Chromium not healthy** | Check logs: `docker compose logs cutengine-chromium` |
| **Ken Burns not working** | Use `"effect": "zoomIn"` as a string at clip level (not nested object) |
| **n8n can't reach services** | Use Docker service names: `http://cutengine:3000`, `http://kokoro-tts:8880` |
| **File Upload Admin not working** | Hard refresh: **Ctrl+Shift+R** |
| **Port already in use** | Change host ports in `docker-compose.yml` |
| **CutEngine render fails — `host.docker.internal`** | **Fixed in latest.** CutEngine now uses Docker service name (`cutengine:3000`) instead of `host.docker.internal` (which doesn't resolve on Linux). No action needed. |
| **CutEngine render fails — `Cannot load libcuda.so.1`** | **Fixed in latest.** Enforced `libx264` software encoder since the host has no NVIDIA GPU. No action needed. |
| **File upload healthcheck fails — `curl: not found`** | **Fixed in latest.** Healthcheck uses Python `urllib` instead of `curl` for wider Docker image compatibility. No action needed. |

## 🔒 Security Notes

- Change all default passwords in `.env` before production use
- Set strong `N8N_ENCRYPTION_KEY` and `N8N_USER_MANAGEMENT_JWT_SECRET`
- Use a reverse proxy (nginx, Caddy) with HTTPS for production
- Never commit `.env` (it's gitignored)
- Set `UPLOAD_API_KEY` if file-upload port is exposed publicly

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
docker compose up -d --build
```

### Firewall (OCI / AWS / GCP)

| Port | Service |
|------|---------|
| `5678` | n8n web UI |
| `8010` | File Upload API + admin |
| `6333` | Qdrant (internal only recommended) |
| `3000` | CutEngine video rendering API |
| `8880` | Kokoro TTS API |

## 📁 Project Structure

```
n8n-qdrant-starter/
├── .env.example              # Environment template
├── docker-compose.yml        # All services (n8n, Qdrant, file-upload, CutEngine, Kokoro)
├── README.md
├── LICENSE                   # MIT
├── scripts/
│   └── n8n-entrypoint.sh
├── cutengine/                # CutEngine source (committed directly)
│   ├── docker/Dockerfile
│   └── ...
├── file-upload-server/       # File Upload API source
│   ├── Dockerfile
│   └── ...
└── ...
```
