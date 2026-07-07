# Remotion Video Render Server — by mimnets

[![Remotion](https://img.shields.io/badge/Remotion-4.0-blue)](https://remotion.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

Self-hosted Remotion-powered video rendering server with Express REST API. Part of the [n8n-qdrant-starter](https://github.com/mimnets/n8n-qdrant-starter) project.

Designed for the companion [n8n-nodes-remotion-render](https://www.npmjs.com/package/n8n-nodes-remotion-render) community node, but can be used standalone via its REST API.

---

## 🚀 Quick Start

```bash
# From the n8n-qdrant-starter root
docker compose up -d remotion

# Check health
curl http://localhost:3000/health
```

Or run standalone:

```bash
cd remotion
npm install
npm run dev   # development (ts-node)
npm run build && npm start   # production
```

---

## 🎬 VideoComposition Features

The core rendering engine (`src/compositions/VideoComposition.tsx`) supports:

| Feature | Description |
|---------|-------------|
| 🖼️ **Multiple images** with Ken Burns effects | zoomIn, zoomOut, slideLeft, slideRight, slideUp, slideDown |
| 📝 **Text overlays** | Position at bottom (captions), center, or top |
| 🎨 **Custom text styling** | Font family, size, color, weight, background |
| ✨ **Animated text entrances** | Fade In, Slide Up, Scale In, Typewriter |
| 🔡 **TikTok-style word-by-word captions** | Gold-highlighting per word, word timing configurable |
| 🎵 **Multi-track audio** | Scene-specific audio clips + background soundtrack |
| 🖼️ **Image fit modes** | `cover` (fill & crop), `contain` (fit inside), `fill` (stretch) |
| 🔄 **Crossfade transitions** | Automatic dissolve between overlapping image clips |
| 🖌️ **HTML scenes** | Rich HTML for text-heavy layouts |
| 🔊 **Full-length audio playback** | Audio plays to completion, not truncated to scene length |

### Audio Fix (v1.0.1+)

Audio clips no longer get cut off mid-playback. Removed `durationInFrames` from `<Sequence>` wrapping audio elements, so audio plays to its full natural duration regardless of scene timing.

### Image Fit (v1.0.1+)

`ImageScene` now reads the `fit` property from each clip, so per-scene fit modes are respected:
- `cover` — fills the frame, crops excess (default)
- `contain` — shows entire image with letterboxing
- `fill` — stretches to fill frame (distorts aspect ratio)

### TikTok Captions (v1.0.1+)

When `captionStyle: "tiktok"` is set on a text asset, captions render word-by-word with gold highlighting, synced to estimated timing per word. The `combineMs` parameter controls how many milliseconds worth of words appear per group (400ms = classic TikTok speed, 1200ms = sentence-by-sentence).

---

## 📡 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/edit/v1/render` | Submit a render job |
| `GET` | `/edit/v1/render/{id}` | Get render status |
| `GET` | `/serve/v1/assets/{id}/output.mp4` | Download rendered MP4 |
| `GET` | `/tools/api-builder` | Visual JSON builder |

---

## 📦 Render Payload

```json
{
  "timeline": {
    "background": "#000000",
    "soundtrack": { "src": "https://.../bgm.mp3", "volume": 0.15 },
    "tracks": [
      {
        "clips": [
          {
            "asset": { "type": "image", "src": "https://.../img1.jpg" },
            "start": 0,
            "length": 5,
            "effect": "zoomIn",
            "fit": "cover"
          }
        ]
      },
      {
        "clips": [
          {
            "asset": {
              "type": "text",
              "text": "Hello World",
              "font": { "family": "Inter", "size": 36, "color": "#FFFFFF", "weight": 400 },
              "alignment": { "horizontal": "center", "vertical": "bottom" },
              "background": "rgba(0,0,0,0.3)",
              "captionStyle": "tiktok",
              "combineMs": 400
            },
            "start": 0,
            "length": 5,
            "textAnimation": "fadeIn"
          }
        ]
      },
      {
        "clips": [
          {
            "asset": { "type": "audio", "src": "https://.../narration.mp3" },
            "start": 0,
            "length": 5
          }
        ]
      }
    ]
  },
  "output": { "format": "mp4", "resolution": "1080", "fps": 25 }
}
```

### Asset Types

| `type` | Asset schema | Clips |
|--------|-------------|-------|
| `image` | `{ type: "image", src: string }` | `effect?`, `fit?`, `transition?` |
| `text` | `{ type: "text", text, font?, alignment?, background?, captionStyle?, combineMs? }` | `textAnimation?` |
| `audio` | `{ type: "audio", src: string }` | `start`, `length` |
| `html` | `{ type: "html", html: string }` | — |

### Ken Burns Effects

| Value | Description |
|-------|-------------|
| `zoomIn` | Slow zoom into image (default) |
| `zoomOut` | Slow zoom out |
| `slideLeft` | Pan left |
| `slideRight` | Pan right |
| `slideUp` | Pan up |
| `slideDown` | Pan down |
| `zoomInFast` | Fast zoom in |
| `zoomOutFast` | Fast zoom out |

### Text Animations

| Value | Description |
|-------|-------------|
| `none` | Static text (default) |
| `fadeIn` | Opacity fade in |
| `slideUp` | Fade in + slide up |
| `scale` | Scale from 0.8x to 1x |
| `typewriter` | Reveal character by character |

### Caption Styles

| Value | Description |
|-------|-------------|
| `static` | Full text visible for entire duration |
| `tiktok` | Word-by-word gold highlighting, timed by `combineMs` |

---

## 🏗 Building & Rebuilding

```bash
# From n8n-qdrant-starter root
docker compose build remotion
docker compose up -d remotion

# Check logs
docker compose logs remotion -f
```

### Image layer caching

The first build downloads Chromium (~400MB) and npm dependencies. Subsequent builds are fast.

---

## 📁 File Structure

```
remotion/
├── Dockerfile
├── package.json
├── remotion.config.ts
├── tsconfig.json
├── src/
│   ├── server.ts                    # Express server + render routes
│   ├── Root.tsx                     # Remotion composition registration
│   └── compositions/
│       └── VideoComposition.tsx     # All rendering logic
└── public/
    └── tools/
        └── api-builder.html         # Visual JSON builder UI
```

---

## 🔌 Companion n8n Node

The [n8n-nodes-remotion-render](https://www.npmjs.com/package/n8n-nodes-remotion-render) community node wraps this API into a drag-and-drop node for n8n with three input modes:

- **Manual** — drag-and-drop fields in the UI
- **From Input JSON** — pass structured data from Code/LLM nodes
- **⭐ Sequence Combiner** — each upstream item = one scene, perfect for loops
- **Auto Collect** — auto-detect images/audios/texts from any upstream node

---

## 📄 License

MIT — part of the [n8n-qdrant-starter](https://github.com/mimnets/n8n-qdrant-starter) project.
