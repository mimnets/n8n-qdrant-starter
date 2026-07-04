# n8n-nodes-remotion-render

n8n community node for rendering videos using a self-hosted [Remotion](https://remotion.dev) server.

Built for the [n8n-qdrant-starter](https://github.com/mimnets/n8n-qdrant-starter) project.

## Features

- **Render videos** with images (Ken Burns effects), text overlays, and multi-track audio
- **Dynamic input** — use upstream data OR configure manually in the node UI
- **Automatic poll** — node blocks until render is done, returns the video URL
- **Self-hosted** — connects to your own Remotion server at any URL

## Installation

### Quick install (recommended)

1. In your n8n instance, go to **Settings → Community Nodes**
2. Click **Install**
3. In the **npm Package Name** field, enter: `n8n-nodes-remotion-render`
4. Click **Install**

### Docker install

If you're running n8n in Docker (like this project), mount a custom nodes folder:

```bash
mkdir -p ~/n8n-custom-nodes
cd ~/n8n-custom-nodes
npm init -y
npm install n8n-nodes-remotion-render
```

Then add to your docker-compose.yml:

```yaml
environment:
  - N8N_CUSTOM_EXTENSIONS=/path/to/n8n-custom-nodes
volumes:
  - ~/n8n-custom-nodes:/path/to/n8n-custom-nodes
```

## Setup

After installation, create a credential:

1. Go to **Credentials → New → Remotion Render API**
2. Set **Server URL** to your Remotion server (e.g., `http://remotion:3000` or `http://192.168.1.100:3000`)
3. Add an **API Key** if your server requires authentication

## Usage

### Manual mode

Add images, text, and audio clips directly in the node UI:

1. Add **Images** with URLs, start times, lengths, and Ken Burns effects
2. Add **Text Overlays** with alignment (vertical: bottom for captions), font, and color
3. Add **Audio Clips** or a **Soundtrack**

### Input JSON mode

Connect any upstream node that outputs this structure:

```json
{
  "images": [
    { "src": "https://...", "start": 0, "length": 5, "effect": "zoomIn" }
  ],
  "texts": [
    { "text": "Hello", "start": 0, "length": 5, "vertical": "bottom" }
  ],
  "audios": [
    { "src": "https://...", "start": 0, "length": 5 }
  ],
  "soundtrack": { "src": "https://...", "volume": 0.15 },
  "resolution": "1080",
  "fps": 25
}
```

Use with a Code node, HTTP Request, or any n8n node that returns JSON.

### Output

The node returns:

```json
{
  "renderId": "abc123...",
  "status": "done",
  "videoUrl": "http://remotion:3000/serve/v1/assets/abc123/output.mp4",
  "downloadUrl": "http://remotion:3000/serve/v1/assets/abc123/output.mp4",
  "pollsNeeded": 5
}
```

## Node Fields Reference

| Section | Field | Description |
|---|---|---|
| **Images** | Image URL | Public URL of the image |
| | Start | When the image appears (seconds) |
| | Length | How long it stays on screen (seconds) |
| | Ken Burns Effect | zoomIn, zoomOut, slideLeft, etc. |
| | Fade In/Out | Fade transition at start/end |
| **Text** | Text | Caption content |
| | Vertical Position | **bottom** for captions, center/top for titles |
| | Horizontal Position | left, center, right |
| | Font | Family, size, weight, color |
| | Background | Semi-transparent background behind text |
| **Audio** | URL | Audio file URL |
| | Start/Length | When and how long it plays |
| **Soundtrack** | URL | Background music |
| | Volume | 0.0 to 1.0 (0.15 recommended) |
| **Output** | Resolution | preview, mobile, sd, hd, 1080, 4k |
| | FPS | 25 recommended |

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Watch mode
npm run dev
```

## License

MIT
