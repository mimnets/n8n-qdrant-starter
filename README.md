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
- **[Remotion](https://remotion.dev)** — programmatic video render engine (React-based) with Ken Burns zoom, transitions, captions, multi-track audio, and HTML scenes
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
    │ File Upload  │  │   Remotion    │       │
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

# 4. Start everything (builds Remotion + file-upload from local source)
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
| **Remotion API** | `http://localhost:3000` |
| **Remotion Health** | `http://localhost:3000/health` |
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
| `remotion` | *local build* — `remotion/Dockerfile` | `3000` | ✅ healthcheck |
| `kokoro-tts` | `ghcr.io/remsky/kokoro-fastapi-cpu:latest` | `8880` | ✅ healthcheck |

**Note:** Remotion and file-upload are built from source locally. The first `docker compose up -d` will build these automatically (Remotion may take 2-5 min on first build).

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

## 🎥 Remotion — Video Rendering (React-based)

[![Remotion](https://img.shields.io/badge/Remotion-4.0-blue)](https://remotion.dev)

Remotion is a programmatic video render engine powered by React. It replaces CutEngine with a more reliable, well-maintained, and actively developed framework.

### Features

- **Ken Burns zoom effects** — zoomIn, zoomOut, slideLeft, slideRight, slideUp, slideDown
- **Text overlays** — any system font, any position, with background/shadow styling
- **HTML scenes** — rich HTML with full CSS for text-heavy videos
- **Audio** — soundtrack + per-scene audio clips
- **All standard resolutions** — preview, mobile, sd, hd, 1080, 4k
- **Aspect ratios** — 16:9, 9:16, 1:1, 4:5, 4:3

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/edit/v1/render` | Submit a render job |
| `GET` | `/edit/v1/render/{id}` | Get render status |
| `GET` | `/serve/v1/assets/{id}/output.mp4` | Download rendered video |

### From n8n Workflows — Zoom + Audio + Captions

**1. Submit a render**

```
POST http://remotion:3000/edit/v1/render
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
            "font": { "family": "sans-serif", "size": 48, "color": "#ffffff" }
          },
          "start": 0,
          "length": {{ $('audio-code').item.json.video_length }},
          "position": "bottom"
        }]
      }
    ]
  },
  "output": { "format": "mp4", "resolution": "1080" }
}
```

→ Returns `{"success": true, "response": {"id": "abc123", "status": "rendering"}}`

**2. Poll for status**

```
GET http://remotion:3000/edit/v1/render/{id}
```
→ Status: `rendering` → `done`

**3. Download**

```
GET http://remotion:3000/serve/v1/assets/{id}/output.mp4
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
| `text` | Text overlay with font styling |
| `html` | Rich HTML/CSS content |
| `audio` | Audio file |

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
5. Remotion → Submit render with image + audio + captions + zoom
6. Poll render status → Download final MP4
7. Upload to File Upload API → Permanent file URL
```

---

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Remotion build fails** | First build takes 2-5 min (npm install + Chromium bundle). Check logs: `docker compose logs remotion` |
| **n8n can't reach services** | Use Docker service names: `http://remotion:3000`, `http://kokoro-tts:8880` |
| **File Upload Admin not working** | Hard refresh: **Ctrl+Shift+R** |
| **Port already in use** | Change host ports in `docker-compose.yml` |
| **File upload healthcheck fails** | Healthcheck uses Python `urllib`. Ensure `python3` is available in the container |
| **Upload node error: "Field required" for file** | Set Form-Data field `file` → Mode: "From Binary Property" → Property: `data` |

## 🔒 Security Notes

- Change all default passwords in `.env` before production use
- Set strong `N8N_ENCRYPTION_KEY` and `N8N_USER_MANAGEMENT_JWT_SECRET`
- Use a reverse proxy (nginx, Caddy) with HTTPS for production
- Never commit `.env` (it's gitignored)
- Set `UPLOAD_API_KEY` if file-upload port is exposed publicly

## 💾 Backups

Docker volumes are backed up automatically via cron:

```bash
# Run at 2:00 AM UTC daily
0 2 * * * /home/ubuntu/backup-volumes.sh >> /home/ubuntu/backups/backup.log 2>&1
```

**Backed up volumes:** n8n_storage, postgres_storage, qdrant_storage, file_uploads, remotion_output  
**Retention:** Last 7 daily backups kept  
**Location:** `/home/ubuntu/backups/`

### Restore from backup

```bash
# List available backups
ls /home/ubuntu/backups/*.tar.gz

# Restore a specific volume
/home/ubuntu/restore-volume.sh n8n-qdrant-starter_n8n_storage /home/ubuntu/backups/n8n-qdrant-starter_n8n_storage-2026-07-02.tar.gz
```

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
| `3000` | Remotion video rendering API |
| `8880` | Kokoro TTS API |

## 📁 Project Structure

```
n8n-qdrant-starter/
├── .env.example              # Environment template
├── docker-compose.yml        # All services (n8n, Qdrant, file-upload, Remotion, Kokoro)
├── README.md
├── LICENSE                   # MIT
├── scripts/
│   └── n8n-entrypoint.sh
├── remotion/                 # Remotion video render engine (replaces CutEngine)
│   ├── Dockerfile
│   ├── src/
│   │   ├── server.ts
│   │   ├── Root.tsx
│   │   └── compositions/
│   │       └── VideoComposition.tsx
│   └── package.json
├── file-upload-server/       # File Upload API source
│   ├── Dockerfile
│   └── ...
└── ...
```
