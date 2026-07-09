# n8n-nodes-remotion-render — by mimnets

[![npm version](https://img.shields.io/npm/v/n8n-nodes-remotion-render)](https://www.npmjs.com/package/n8n-nodes-remotion-render)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-remotion-render)](https://www.npmjs.com/package/n8n-nodes-remotion-render)

An n8n community node for rendering videos using a self-hosted [Remotion](https://remotion.dev) server. Part of the [n8n-qdrant-starter](https://github.com/mimnets/n8n-qdrant-starter) project.

---

## 🚀 Features

- **📷 Multiple images** with Ken Burns effects (zoom, slide, pan)
- **📝 Text overlays** — captions, titles, TikTok word-by-word style
- **🎵 Multi-track audio** — scene-specific clips + background soundtrack
- **🔄 2 input methods**:
  - **Manual** — configure everything in the node UI
  - **⚡ Batch Render** — each upstream item = one scene, renders individually, concats with ffmpeg, returns video as **binary data** (no internal upload — you control upload)
- **⏳ Auto-poll** — blocks until video is ready
- **🎬 Resolutions** — preview, mobile, SD, HD (1080p), vertical/Reels, 4K
- **🎨 Configurable per-scene defaults** — image effects, fades, fonts, colors, caption style, text animation, alignment — with per-item overrides
- **🌐 Any Remotion server** — local Docker, remote VPS, or cloud

---

## 📦 Installation

### Quick install (via n8n UI)

1. In your n8n, go to **Settings → Community Nodes**
2. Click **Install**
3. Enter: `n8n-nodes-remotion-render`
4. Click **Install**

### Manual Docker install (for this project)

If you're running the [n8n-qdrant-starter](https://github.com/mimnets/n8n-qdrant-starter) Docker setup, mount the node into the n8n container:

```yaml
# docker-compose.yml — add to n8n service
n8n:
  environment:
    - N8N_CUSTOM_EXTENSIONS=/home/node/custom-nodes
  volumes:
    - ./n8n-nodes-remotion-render:/home/node/custom-nodes/n8n-nodes-remotion-render
```

Then restart n8n:
```bash
docker compose up -d n8n
```

---

## 🔐 Credential Setup

1. **n8n → Credentials → Add New → Remotion Render API - mimnets**
2. **Server URL**: `http://remotion:3000` (Docker internal) or your external IP
3. **API Key**: leave blank
4. **Save**

---

## 🎬 Usage

### Input Method: Manual

1. **Operation → Render Video**, **Input Method → Manual**
2. Add images, text overlays, audio clips, and soundtrack
3. Set resolution and FPS
4. Run — returns the rendered video URL

**Best for:** Testing, fixed-content videos, predictable timelines.

---

### Input Method: ⚡ Batch Render

Each upstream item = **one scene**. Scenes are rendered individually, then concatenated with ffmpeg. **Perfect for per-scene zoom + captions + audio** without timeline complexity.

1. **Input Method → Batch Render**
2. Connect any upstream node that outputs scene objects
3. Set Resolution and FPS

#### What each upstream item should look like

```json
{
  "imageUrl": "https://.../scene1.png",
  "audioUrl": "https://.../scene1.mp3",
  "caption": "First scene caption",
  "duration": 5,
  "scene_number": 1
}
```

#### Output

The node returns the final concatenated video as **binary data** — no internal file upload. After the node, connect your own upload/publish chain:

```
[Remotion Render (Batch)] → [Code Node] → [HTTP Request (upload)] → wherever
```

The JSON output contains `{ status, scenesProcessed, fileName }` and the video is attached as `$binary.data`.

#### Per-item overrides

Each scene item can override the Batch Render Defaults via its own fields. **Precedence: item field → UI default → hardcoded fallback**

| Field | Overrides | Example |
|---|---|---|
| `effect` | Image Effect | `"slideLeft"` |
| `fit` | Image Fit | `"contain"` |
| `fadeIn` | Image Fade In | `true` |
| `fadeOut` | Image Fade Out | `true` |
| `fontSize` | Font Size | `48` |
| `fontColor` | Font Color | `"#FFD700"` |
| `fontFamily` | Font Family | `"Arial"` |
| `fontWeight` | Font Weight | `700` |
| `background` | Background | `"rgba(0,0,0,0.5)"` |
| `captionStyle` | Caption Style | `"static"` |
| `combineMs` | Word Timing | `800` |
| `textAnimation` | Text Animation | `"slideUp"` |
| `vertical` | Vertical Position | `"top"` |
| `horizontal` | Horizontal Position | `"left"` |

Example with overrides:

```json
{
  "imageUrl": "...",
  "audioUrl": "...",
  "caption": "Custom scene",
  "duration": 5,
  "effect": "slideRight",
  "fontSize": 48,
  "fontColor": "#FFD700",
  "textAnimation": "fadeIn"
}
```

#### Requirements

- **ffmpeg** must be installed in the n8n container
- Scenes render sequentially (one at a time)

**Best for:** AI pipelines, per-scene audio+caption sync, loops, variable-length scenes.

---

## 📋 Node Fields Reference

### Batch Render settings

| Field | Default | Description |
|---|---|---|
| Resolution | `vertical` (1080×1920) | Preview, mobile, SD, HD, 1080, vertical, 4K |
| FPS | 30 | Frames per second |

### Batch Render Defaults (collapsible in UI)

**Image defaults:**
- Effect (default: `zoomIn`), Fit (`cover`), Fade In/Out (`false`)

**Text defaults:**
- Font: Family (`Inter`), Size (`36`), Color (`#FFFFFF`), Weight (`400`)
- Background (`rgba(0,0,0,0.3)`)
- Caption Style (`tiktok`), Word Timing (`400ms`)
- Animation (`none`), Vertical (`bottom`), Horizontal (`center`)

### Image fields (Manual)

| Field | Description |
|---|---|
| Image URL | Public URL of the image |
| Start (seconds) | When the image appears |
| Length (seconds) | How long it stays |
| Ken Burns Effect | `zoomIn`, `zoomOut`, `slideLeft`, etc. |
| Fade In / Fade Out | Toggle fades |

### Text fields (Manual)

| Field | Description |
|---|---|
| Text | Caption or title content |
| Start / Length | Timing |
| Vertical Position | `bottom` (captions), `center`, `top` |
| Font | Family, Size, Weight, Color |
| Background | CSS color behind text |
| Caption Style | Static or TikTok word-by-word |

### Audio fields (Manual)

| Field | Description |
|---|---|
| Audio URL | Public URL (mp3, wav, ogg) |
| Start / Length | Timing |
| Soundtrack | Background music with volume control |

---

## 🔧 Remotion Server

Your Remotion server at `http://remotion:3000` supports:

| Endpoint | Method | Description |
|---|---|---|
| `/edit/v1/render` | POST | Submit a render job |
| `/edit/v1/render/:id` | GET | Check render status |
| `/serve/v1/assets/:id/output.mp4` | GET | Download rendered MP4 |
| `/health` | GET | Server health |

### Resolutions

| Value | Dimensions | Use case |
|---|---|---|
| `preview` | 512×288 | Quick testing |
| `mobile` | 640×360 | Phone-optimized |
| `sd` | 1024×576 | Standard def |
| `hd` | 1280×720 | YouTube |
| `1080` | 1920×1080 | Full HD |
| `vertical` | 1080×1920 | TikTok/Reels/Shorts |
| `4k` | 3840×2160 | Ultra HD |

---

## 🚨 Troubleshooting

### "Node does not have any credentials set"

Create a **Remotion Render API - mimnets** credential with Server URL `http://remotion:3000`.

### ffmpeg concat fails (Batch Render)

Ensure ffmpeg is installed in the n8n container. See your project's `n8n/Dockerfile`.

### Render fails or times out

- Check server: `curl http://remotion:3000/health`
- Check logs: `docker compose logs remotion`
- Ensure all image/audio URLs are publicly accessible

---

## 🏗 Development

```bash
cd n8n-nodes-remotion-render
npm install
npm run build          # TypeScript → dist/
npm run dev            # Watch mode
npm version patch      # Bump version
npm publish
```

---

## 📄 License

MIT — use it freely. Built for the [n8n-qdrant-starter](https://github.com/mimnets/n8n-qdrant-starter) — a self-hosted AI video automation stack.
