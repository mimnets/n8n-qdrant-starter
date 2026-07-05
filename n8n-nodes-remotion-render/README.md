# n8n-nodes-remotion-render — by mimnets

[![npm version](https://img.shields.io/npm/v/n8n-nodes-remotion-render)](https://www.npmjs.com/package/n8n-nodes-remotion-render)
[![npm downloads](https://img.shields.io/npm/dm/n8n-nodes-remotion-render)](https://www.npmjs.com/package/n8n-nodes-remotion-render)

An n8n community node for rendering videos using a self-hosted [Remotion](https://remotion.dev) server. Part of the [n8n-qdrant-starter](https://github.com/mimnets/n8n-qdrant-starter) project.

---

## 🚀 Features

- **📷 Multiple images** with Ken Burns effects (zoom, slide, pan)
- **📝 Text overlays** — captions (bottom), titles (center/up), TikTok word-by-word style
- **🎵 Multi-track audio** — scene-specific audio clips + background soundtrack
- **🔄 3 input methods**:
  - **Manual** — drag-and-drop fields in the node UI
  - **From Input JSON** — pipe structured JSON from upstream nodes
  - **Auto Collect** — **★ NEW** detects images/audios/texts automatically from any upstream node, no config needed
- **⏳ Auto-poll** — node blocks until video is ready, returns download URL
- **🎬 Resolutions** — preview, mobile, SD, HD (1080p), vertical/Reels, 4K
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

After installing the node, create a credential:

1. **n8n → Credentials → Add New → Remotion Render API - mimnets**
2. **Server URL**: `http://remotion:3000` (Docker network name)  
   *or* `http://150.136.150.227:3000` (external IP)
3. **API Key**: leave blank (your server doesn't require one)
4. **Save**

---

## 🎬 Usage

### Input Method: Manual (drag-and-drop)

> **Node colors**: 🟣 **Remotion Render - mimnets** in the n8n editor

1. Drag the **Remotion Render - mimnets** node into your workflow
2. Select **Operation → Render Video**
3. Choose **Input Method → Manual**
4. Click **Add Image** — fill in URL, start time, length, effect
5. Click **Add Text** — enter caption, set **Vertical Position → Bottom**
6. Click **Add Audio** or fill in **Soundtrack** for background music
7. Set **Resolution → 1080** (or whatever you need)
8. Connect a trigger node before it (Manual, Webhook, Schedule, etc.)
9. Run the workflow

**Best for:** Testing, fixed content, predictable timelines.

---

### Input Method: From Input JSON (structured data)

Use this when you want to pass data from an upstream Code node, LLM node, or HTTP request:

1. **Input Method → From Input JSON**
2. Connect the output of any node that returns this structure:

```json
{
  "images": [
    { "src": "https://example.com/photo1.jpg", "start": 0, "length": 10, "effect": "zoomIn" },
    { "src": "https://example.com/photo2.jpg", "start": 10, "length": 10, "effect": "slideLeft" }
  ],
  "texts": [
    { "text": "Welcome to my video!", "start": 0, "length": 5, "vertical": "bottom", "fontSize": 48 },
    { "text": "Thanks for watching", "start": 15, "length": 5, "vertical": "bottom" }
  ],
  "audios": [
    { "src": "https://example.com/narration-1.mp3", "start": 0, "length": 10 }
  ],
  "soundtrack": { "src": "https://example.com/background-music.mp3", "volume": 0.15 },
  "resolution": "1080",
  "fps": 25
}
```

Example using an n8n Code node:

```javascript
// Code node — outputs pass to Remotion Render node
const images = [
  { src: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564", start: 0, length: 8, effect: "zoomIn" },
  { src: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4", start: 8, length: 8, effect: "slideRight" },
];

const texts = [
  { text: "Amazing Nature", start: 0, length: 16, vertical: "bottom", fontSize: 48, fontColor: "#FFFFFF" },
];

return { images, texts, resolution: "1080", fps: 25 };
```

**Best for:** Power users, custom logic, AI-generated content, structured data pipelines.

---

### Input Method: Auto Collect (★ NEW — recommended for most workflows)

This is the easiest way to use the node. **No Code node needed.** Connect *any* upstream node that outputs image URLs, audio files, or text content — the node detects everything automatically.

1. Select **Input Method → Auto Collect**
2. Connect upstream nodes (image generators, file uploaders, AI text nodes, etc.)
3. (Optional) Adjust defaults under **Auto Collect Defaults**
4. Run

#### How detection works

The node scans every item from the previous node and classifies it:

| Detection method | What's detected |
|---|---|
| **Explicit `type` field** | Set `type: "image"`, `type: "audio"`, `type: "text"`, or `type: "soundtrack"` |
| **File extension** | `.jpg` / `.png` / `.webp` / `.gif` → image |
| | `.mp3` / `.wav` / `.ogg` / `.m4a` → audio |
| **Key name patterns** | `url` / `src` + image-like keys (`image`, `photo`, `thumbnail`) → image |
| | `soundtrack` / `bgm` / `background_music` / `music` keys → soundtrack |
| | `text` / `caption` / `title` / `headline` keys → text overlay |
| **content_type / mime** | `image/png`, `audio/mpeg`, etc. |

#### What gets auto-timelined

- **Images** — placed sequentially, each gets the default duration (configurable, 4s default)
- **Audio clips** — aligned with images by index, or all start at frame 0
- **Text overlays** — placed alongside corresponding images
- **Soundtrack** — plays throughout the entire video

#### Example workflows

**5 images from an image generator:**

```
[Image Generation Node] → outputs 5 items, each { url: "https://.../img.png" }
        ↓
[Remotion Render - Auto Collect]
   → Detects 5 images
   → Auto-timelines: each gets 4s = 20s video
   → Renders and returns download URL
```

**Images + voice-overs from separate nodes:**

```
[Image Gen]  ──→ { url: "img1.png" }, { url: "img2.png" }
                    ↓
[Voice Gen]  ──→ { url: "voice1.mp3" }, { url: "voice2.mp3" }
                    ↓
[Merge Node (combine)]
                    ↓
[Remotion Render - Auto Collect]
   → Detects: 2 images + 2 audio
   → Aligns by index: img1+voice1 play together, img2+voice2 next
   → Renders video with audio synced to visuals
```

**Mixed items (no extra nodes needed):**

If your upstream outputs items with both `url: "img.jpg"` and `caption: "hello"`, the node extracts both and places them on the timeline together.

#### Auto Collect defaults you can configure

| Setting | Default | Description |
|---|---|---|
| Image Duration | 4s | Seconds each image stays on screen |
| Image Effect | fade | Ken Burns effect: fade, zoomIn, slideLeft, etc. |
| Image Fit | contain | Contain = show full image, Cover = fill & crop |
| Audio Align Mode | by index | Index = align with images, All at start = simultaneous |
| Text Position | bottom | Bottom, center, or top |
| Text Font Size | 40 | Default caption size |
| Text Font Color | #FFFFFF | White |
| Soundtrack Volume | 0.15 | Quiet background (0–1) |
| Resolution | 1080 | Full HD (1920×1080) |
| FPS | 25 | Frames per second |

**Best for:** Beginners, variable-content workflows, quick prototypes, AI pipelines where the number of items changes each run.

---

### Output

The node returns:

```json
{
  "renderId": "abc123def456",
  "status": "done",
  "videoUrl": "http://remotion:3000/serve/v1/assets/abc123def456/output.mp4",
  "downloadUrl": "http://remotion:3000/serve/v1/assets/abc123def456/output.mp4",
  "pollsNeeded": 8
}
```

Pass `downloadUrl` into an HTTP Request node (GET, Response Format: File) to download the MP4, or use it directly as a source URL.

---

## 🧩 Full Workflow Examples

### Example 1: AI images → video reel

```
[OpenClaw Image Generator]  → 5 social media images
        ↓
[Remotion Render - Auto Collect]  → detects images, builds reel
        ↓
[HTTP Request]  → download MP4
        ↓
[Telegram / Discord]  → publish
```

### Example 2: Structured data (Code node)

```
[Manual Trigger]
        ↓
[Code Node]  ← Build images[], texts[], audios[]
        ↓
[Remotion Render - From Input JSON]
        ↓
[HTTP Request]  → download file
```

### Example 3: Voice-over slideshow

```
[Image Upload Node]  → { url: "...", caption: "Slide 1" }
                     → { url: "...", caption: "Slide 2" }
        ↓
[Remotion Render - Auto Collect]
   → Detects: 2 images + 2 captions
   → Timeline: img1 + "Slide 1" → img2 + "Slide 2"
   → Renders video
```

---

## 📋 Node Fields Reference

### Image fields

| Field | Type | Description |
|---|---|---|
| Image URL | string | Public URL of the image |
| Start (seconds) | number | When the image appears |
| Length (seconds) | number | How long it stays on screen |
| Ken Burns Effect | select | `zoomIn`, `zoomOut`, `slideLeft`, `slideRight`, `slideUp`, `slideDown`, `zoomInFast`, `zoomOutFast`, or None |
| Fade In | boolean | Fade in at start of clip |
| Fade Out | boolean | Fade out at end of clip |

### Text fields

| Field | Type | Description |
|---|---|---|
| Text | string | Caption or title content |
| Start (seconds) | number | When text appears |
| Length (seconds) | number | How long it stays |
| **Vertical Position** | select | **`bottom`** for captions, `center` / `top` for titles |
| Horizontal Position | select | `left`, `center`, `right` |
| Font Family | string | CSS font name (must be in Remotion container) |
| Font Size | number | px size (scales with resolution) |
| Font Weight | number | 100–900 (400=normal, 700=bold) |
| Font Color | color | Hex color picker |
| Background Color | string | CSS color like `rgba(0,0,0,0.3)` |

### Audio fields

| Field | Type | Description |
|---|---|---|
| Audio URL | string | URL of audio file (mp3, wav, ogg) |
| Start (seconds) | number | When audio starts |
| Length (seconds) | number | How long it plays |

### Soundtrack (background audio)

| Field | Type | Description |
|---|---|---|
| Audio URL | string | Background music URL |
| Volume | number | 0–1 (0.15 = quiet background, 1 = full volume) |

### Output settings (Manual mode)

| Field | Type | Description |
|---|---|---|
| Resolution | select | `preview` (512×288), `mobile` (640×360), `sd` (1024×576), `hd` (1280×720), **`1080`** (1920×1080), `vertical` (1080×1920), `4k` (3840×2160) |
| FPS | number | 1–60 (25 recommended) |

---

## 🔧 Remotion Server Configuration

Your Remotion server at `http://remotion:3000` supports these endpoints:

| Endpoint | Method | Description |
|---|---|---|
| `/edit/v1/render` | POST | Submit a render job (returns immediately with render ID) |
| `/edit/v1/render/:id` | GET | Check render status — returns `"done"` when video is ready |
| `/serve/v1/assets/:id/output.mp4` | GET | Download the rendered MP4 |
| `/health` | GET | Server health check |
| `/tools/api-builder` | GET | Visual JSON builder for the render payload |

### Available Ken Burns effects

| Value | Effect |
|---|---|
| `zoomIn` | Slow zoom into the image |
| `zoomOut` | Slow zoom out of the image |
| `zoomInFast` | Faster zoom in |
| `zoomOutFast` | Faster zoom out |
| `slideLeft` | Pan image to the left |
| `slideRight` | Pan image to the right |
| `slideUp` | Pan image upward |
| `slideDown` | Pan image downward |

### Available resolutions

| Value | Dimensions | Use case |
|---|---|---|
| `preview` | 512×288 | Quick previews, testing |
| `mobile` | 640×360 | Phone-optimized, social media |
| `sd` | 1024×576 | Standard definition |
| `hd` | 1280×720 | YouTube, social platforms |
| `1080` (default) | 1920×1080 | Full HD — best quality |
| `vertical` | 1080×1920 | TikTok/Reels/Shorts |
| `4k` | 3840×2160 | Ultra HD — longer render times |

### Rebuilding the Remotion container

If you modify the VideoComposition or server code:

```bash
cd /home/ubuntu/n8n-qdrant-starter
docker compose build remotion
docker compose up -d remotion
```

---

## 🚨 Troubleshooting

### Auto Collect detects nothing

The upstream data doesn't have recognizable fields. Common fixes:

1. **Use explicit `type` field** — add `"type": "image"` or `"type": "audio"` to each item
2. **Check your field names** — the node looks for `url`, `src`, `image`, `photo`, `caption`, `text`, `soundtrack`
3. **Check file extensions** — `.png`, `.jpg`, `.mp3` are the most reliable signals
4. **Still not working?** — Switch to **From Input JSON** mode and use a Code node to format the data

### Text stays in center (not at bottom)

The Remotion server uses `position: absolute; bottom: 80px` for `vertical: "bottom"`. Make sure:
1. The Remotion container is rebuilt: `docker compose build remotion && docker compose up -d remotion`
2. The node's **Vertical Position** is set to **Bottom**
3. Check the server logs: `docker compose logs remotion`

### "Node does not have any credentials set"

You need to create a credential first:
1. n8n → **Credentials** → **Add New** → **Remotion Render API - mimnets**
2. Set **Server URL** to `http://remotion:3000`
3. Save
4. In the node, select this credential from the dropdown

### Render fails or times out

- Check the Remotion server is running: `curl http://remotion:3000/health`
- Check server logs: `docker compose logs remotion`
- Longer videos take more time — the node polls for up to 5 minutes
- Ensure all image URLs and audio URLs are publicly accessible

### Node icon shows broken image

Update to the latest version: `n8n-nodes-remotion-render@0.3.0+` includes an SVG icon.

---

## 🏗 Development

```bash
# Clone / navigate to the project
cd n8n-qdrant-starter/n8n-nodes-remotion-render

# Install dependencies
npm install

# Build (TypeScript → dist/)
npm run build

# Watch mode (auto-compile on changes)
npm run dev

# Publish to npm
npm version patch
npm publish
```

---

## 📄 License

MIT — use it freely in personal, commercial, and open-source projects.

Built for the [n8n-qdrant-starter](https://github.com/mimnets/n8n-qdrant-starter) — a self-hosted AI video automation stack.
