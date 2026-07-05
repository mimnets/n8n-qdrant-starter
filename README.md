# n8n + Qdrant + AI Automation Stack 🚀

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Production-ready AI automation stack — n8n workflows, Qdrant vector search,
> self-hosted file upload, programmatic video rendering with Remotion, and
> text-to-speech. All services in one `docker compose up`.

## 📖 Overview

A lightweight, self-hosted stack combining:

- **[n8n](https://n8n.io)** — workflow automation engine (400+ integrations)
- **[Qdrant](https://qdrant.tech)** — vector database for semantic search, RAG, and AI memory
- **[File Upload API](https://hub.docker.com/r/mimnets/n8n-file-upload)** — self-hosted file storage for images, audio, video, documents
- **[Remotion Video Render](https://remotion.dev)** — React-powered programmatic video engine with Ken Burns effects, text overlays, TikTok-style captions, crossfade transitions, multi-track audio, and an n8n community node with 3 input modes (Manual / Input JSON / **Auto Collect**)
- **[Kokoro TTS](https://github.com/remsky/Kokoro-FastAPI)** — text-to-speech with 35+ voices (OpenAI-compatible API)

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  PostgreSQL  │◄────│     n8n      │────►│   Qdrant    │
│  (metadata)  │     │ (automation) │     │  (vectors)  │
└──────────────┘     └──────┬───────┘     └─────────────┘
      :5432                 │                   :6333
                            │
              ┌─────────────┼───────────────────────┐
              │             │                       │
    ┌─────────┴────┐  ┌────┴──────────┐   ┌────────┴───────┐
    │ File Upload  │  │   Remotion    │   │   Kokoro TTS   │
    │ (REST, 8010) │  │ (REST, 3000)  │   │  (REST, 8880)  │
    │  file store  │  │   React/SSR   │   │  TTS / Speech  │
    └──────────────┘  │   Video Gen   │   │   35+ voices   │
                      └───────────────┘   └────────────────┘
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
| **Remotion API Builder** | `http://localhost:3000/tools/api-builder` |
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

**Note:** Remotion and file-upload are built from source locally. The first `docker compose up -d` will build these automatically.

---

## 🎥 Remotion — Programmatic Video Rendering

[![Remotion](https://img.shields.io/badge/Remotion-4.0-blue)](https://remotion.dev)

Remotion is a React-powered programmatic video engine. You describe your video as React components — Remotion renders each frame to a real MP4 video.

### What You Can Do

| Feature | Description |
|---------|-------------|
| 🖼️ **Multiple images** with Ken Burns effects | zoomIn, zoomOut, slideLeft, slideRight, slideUp, slideDown |
| 📝 **Text overlays** | Position at bottom (captions), center, or top. Custom font, color, weight |
| ✨ **Animated text entrances** | Fade In, Slide Up, Scale In, Typewriter — per text clip |
| 🔡 **TikTok-style captions** | Word-by-word gold highlighting — looks like TikTok/Reels |
| 🎵 **Multi-track audio** | Scene-specific audio clips + background soundtrack |
| 🔄 **Crossfade transitions** | Automatic dissolve between overlapping image clips |
| 🎬 **Resolutions** | preview, mobile, SD, HD, **1080p**, **Vertical/Reels**, 4K |
| 📐 **Aspect ratios** | 16:9 (horizontal), 9:16 (vertical/reels) |
| 🖌️ **HTML scenes** | Rich HTML with full CSS for text-heavy layouts |

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/edit/v1/render` | Submit a render job (returns render ID) |
| `GET` | `/edit/v1/render/{id}` | Get render status — `"done"` when video ready |
| `GET` | `/serve/v1/assets/{id}/output.mp4` | Download rendered MP4 |
| `GET` | `/tools/api-builder` | Visual JSON builder UI |

---

## 🔌 n8n Community Node — `n8n-nodes-remotion-render`

[![npm](https://img.shields.io/npm/v/n8n-nodes-remotion-render)](https://www.npmjs.com/package/n8n-nodes-remotion-render)
[![npm](https://img.shields.io/npm/dm/n8n-nodes-remotion-render)](https://www.npmjs.com/package/n8n-nodes-remotion-render)

This project includes a custom n8n community node that wraps the entire Remotion API into a single drag-and-drop node. No need to manually construct JSON payloads or poll for completion. Three input modes: **Manual** (drag-and-drop), **From Input JSON** (structured data), and **Auto Collect** (★ NEW — auto-detect images/audios/texts from any upstream node).

### Install

In n8n: **Settings → Community Nodes → Install** → enter `n8n-nodes-remotion-render`

Or if running n8n in Docker with this stack, add to `docker-compose.yml`:

```yaml
n8n:
  environment:
    - N8N_CUSTOM_EXTENSIONS=/home/node/custom-nodes
  volumes:
    - ./n8n-nodes-remotion-render:/home/node/custom-nodes/n8n-nodes-remotion-render
```

### Setup Credential

1. **n8n → Credentials → Add New → Remotion Render API - mimnets**
2. **Server URL**: `http://remotion:3000`
3. Leave API Key blank
4. **Save**

### Usage — Manual Mode

After adding the node to your workflow:

1. **Add Images** — set URL, start time, length, Ken Burns effect, fade in/out
2. **Add Text Overlays** — enter text, set **Vertical Position → Bottom** for captions
3. Choose **Animation → Fade In / Slide Up / Scale / Typewriter** for text entrance
4. Set **Caption Style → TikTok Style** for word-by-word highlighting
5. **Add Audio Clips** or fill in **Soundtrack** for background music
6. Set **Resolution → 1080** or **Vertical** for TikTok/Reels

### Usage — Input JSON Mode (Dynamic Data)

Connect any upstream node that outputs this structure:

```json
{
  "images": [
    { "src": "https://...", "start": 0, "length": 8, "effect": "zoomIn" }
  ],
  "texts": [
    { "text": "Hello!", "start": 0, "length": 8, "vertical": "bottom", "captionStyle": "tiktok" }
  ],
  "soundtrack": { "src": "https://...", "volume": 0.15 },
  "resolution": "1080",
  "fps": 25
}
```

### Usage — Auto Collect Mode (★ NEW — Zero Config)

The node now has an **Auto Collect** mode that detects images, audios, and text overlays automatically from any upstream node. No Code node or manual mapping needed.

**How it works:**

1. Select **Input Method → Auto Collect**
2. Connect any node that outputs files (image generator, file uploader, AI node, etc.)
3. The node scans every item and auto-detects:
   - **File extensions** — `.png`/`.jpg`/`.webp` → image, `.mp3`/`.wav` → audio
   - **Key names** — `url`, `src`, `image`, `photo`, `caption`, `text`, `soundtrack`
   - **Explicit `type` field** — set `type: "image"`, `type: "audio"`, `type: "text"`
   - **content_type/mime** — `image/png`, `audio/mpeg`
4. Auto-timelines everything: images get sequential duration, audio aligns by index

**Example — 5 images → reel (no Code node):**
```
[Image Generator / Upload API] → outputs { url: "img.png" } × 5
        ↓
[Remotion Render - Auto Collect]
   → Detects 5 images
   → Auto-timelines: each 4s = 20s video
   → Renders MP4
```

Adjust defaults under **Auto Collect Defaults**: image duration, effect, text position, audio alignment, resolution, FPS.

### Output

```json
{
  "renderId": "abc123",
  "status": "done",
  "videoUrl": "http://remotion:3000/serve/v1/assets/abc123/output.mp4"
}
```

---

## 🎬 n8n Workflow Examples

### Example 1: Simple Image + Caption Video

```
[Manual Trigger] → [Remotion Render Node] → [HTTP Request to download video]
```

Configure node:
- **Image**: URL, start 0, length 10, Effect: zoomIn
- **Text**: "My First Video", start 0, length 10, Vertical: Bottom, Animation: Fade In
- **Soundtrack**: background music URL
- **Resolution**: 1080

### Example 2: Multi-image TikTok-style Video

```
[Code Node] → [Remotion Render Node] → [HTTP Request Download]
```

Code node outputs:
```javascript
const images = [
  { src: "https://...img1.jpg", start: 0, length: 5, effect: "zoomIn" },
  { src: "https://...img2.jpg", start: 4, length: 5, effect: "slideLeft" },
  { src: "https://...img3.jpg", start: 8, length: 5, effect: "zoomOut" },
];
const texts = [{
  text: "Amazing nature moments",
  start: 0, length: 13,
  vertical: "bottom", captionStyle: "tiktok", combineMs: 400
}];
return { images, texts, resolution: "vertical", fps: 25 };
```

### Example 3: Zero-Config Auto Collect (★ New)

```
[Image Generator / Unsplash / File Upload]
   → 5-10 images, each { url: "img.png" }
        ↓
[Remotion Render - Auto Collect]
   → Detects images automatically
   → Auto-timelines: each image 4s
   → Renders video
   → Returns download URL
```

No Code node. No manual config. Works whether upstream sends 3 or 20 images.

### Example 4: AI Pipeline — Script → TTS → Video

```
[Code Node with script] → [Kokoro TTS] → [Upload Audio]
    → [Generate Image via AI] → [Upload Image]
    → [Remotion Render] → [Download Video] → [Publish]
```

---

## 🗣️ Kokoro TTS — Text-to-Speech

[![Kokoro FastAPI](https://img.shields.io/badge/Kokoro--FastAPI-5k%E2%98%85-brightgreen)](https://github.com/remsky/Kokoro-FastAPI)

Dockerized FastAPI wrapper for [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M). OpenAI-compatible API with 35+ voices.

### From n8n

```
POST http://kokoro-tts:8880/v1/audio/speech
{
  "model": "kokoro",
  "input": "Your text to speak",
  "voice": "af_bella",
  "response_format": "mp3"
}
```

**Voices:** `af_bella`, `af_sky`, `af_alloy`, `af_jessica`, `am_adam`, `am_michael`, `am_echo`, `bf_emma`, `bm_george` + Japanese, Chinese, Korean, French, Spanish, Italian, Portuguese, Hindi + voice blends.

**Voice blending:** `"voice": "af_bella(2)+af_sky(1)"` → 67% Bella, 33% Sky

---

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Remotion build fails** | First build takes 2-5 min (npm install + Chromium). Check logs: `docker compose logs remotion` |
| **n8n can't reach services** | Use Docker service names: `http://remotion:3000`, `http://kokoro-tts:8880` |
| **Node shows "no credentials"** | Create credential: Server URL = `http://remotion:3000` |
| **Text stays in center** | Set Vertical Position → **Bottom** + rebuild remotion: `docker compose up -d --build remotion` |
| **Broken icon in n8n** | Update node to v0.3.0+: `npm i n8n-nodes-remotion-render@latest` |
| **Auto Collect detects nothing** | Check file extensions (.png, .jpg, .mp3), or add `"type": "image"` to upstream items |
| **TikTok captions not highlighting** | Set Caption Style → TikTok Style + Word Timing → 400ms |
| **Port already in use** | Change host ports in `docker-compose.yml` |

## 🔒 Security Notes

- Change all default passwords in `.env` before production use
- Set strong `N8N_ENCRYPTION_KEY` and `N8N_USER_MANAGEMENT_JWT_SECRET`
- Use a reverse proxy (nginx, Caddy) with HTTPS for production
- Never commit `.env` (it's gitignored)
- Set `UPLOAD_API_KEY` if file-upload port is exposed publicly

## 💾 Backups

Docker volumes backed up daily at 2:00 AM UTC:

```bash
0 2 * * * /home/ubuntu/backup-volumes.sh >> logs/backup.log 2>&1
```

**Backed up:** n8n_storage, postgres_storage, qdrant_storage, file_uploads, remotion_output

### Restore

```bash
ls /home/ubuntu/backups/*.tar.gz
/home/ubuntu/restore-volume.sh volume-name backup.tar.gz
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
| `3000` | Remotion video rendering API + builder UI |
| `8880` | Kokoro TTS API |

## 📁 Project Structure

```
n8n-qdrant-starter/
├── .env.example              # Environment template
├── docker-compose.yml        # All services in one stack
├── README.md
├── LICENSE
├── scripts/
│   └── n8n-entrypoint.sh
├── remotion/                 # Remotion video render engine
│   ├── Dockerfile
│   ├── src/
│   │   ├── server.ts         # Express API + render route
│   │   ├── Root.tsx          # Remotion entry point
│   │   └── compositions/
│   │       └── VideoComposition.tsx  # All rendering logic
│   └── package.json
├── n8n-nodes-remotion-render/        # n8n community node
│   ├── nodes/RemotionRender/         # Node source + UI fields
│   └── credentials/                  # Credential type
├── file-upload-server/      # File Upload API
├── tools/
│   ├── remotion-render-workflow.json # Sample n8n workflow
│   └── REMOTION-ROADMAP.md          # Feature roadmap
└── ...
```
