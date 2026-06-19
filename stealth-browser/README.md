# Stealth Browser API

**Anti-detection browser automation for LinkedIn, Facebook, and other high-security sites.**

Drop-in addition to your [n8n-qdrant-starter](https://github.com/mimnets/n8n-qdrant-starter) stack. Handles the sites that the standard `browser-use` API can't handle because of aggressive anti-bot detection.

## What makes it different from `browser-api`?

| Feature | browser-api | stealth-browser |
|---|---|---|
| Anti-detection | `--disable-blink-features=AutomationControlled` only | Full stealth injection — webdriver, plugins, WebGL, canvas, permissions, chrome.runtime |
| Human behavior | None — AI moves at machine speed | Variable delays, human-like typing (with typos), bezier mouse curves, simulated scrolling |
| Session persistence | Cookie JSON files | Full Chromium user data directory — preserves localStorage, IndexedDB, extension state |
| Multiple profiles | Single profile | Per-site profiles (linkedin, facebook, etc.) |
| Fingerprint consistency | Random per task | Consistent per session — same UA, viewport, locale, timezone |
| VNC | ✅ noVNC + raw VNC | ✅ noVNC + raw VNC (separate port to avoid conflicts) |

## Quick Start

### 1. Add to docker-compose.yml

See `COMPOSE-ADDITION.yml` for the full service definition. Add it to your existing `docker-compose.yml`.

### 2. Build and start

```bash
# From the n8n-qdrant-starter directory
docker compose build stealth-browser
docker compose up -d stealth-browser
```

### 3. One-time: Login manually via VNC

```bash
# Open the browser to LinkedIn login page
curl -X POST http://localhost:8001/api/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://linkedin.com/login", "profile": "linkedin"}'
```

Open `http://localhost:6081/vnc.html` → click into the window → log in manually → then:

```bash
curl -X POST http://localhost:8001/api/session/save \
  -H "Content-Type: application/json" \
  -d '{"profile": "linkedin"}'
```

### 4. Run automated tasks

```bash
curl -X POST http://localhost:8001/api/run \
  -H "Content-Type: application/json" \
  -d '{
    "task": "Go to linkedin.com/feed. Write a post saying: \"Excited to share our latest project updates! Check out the new features we launched this week. #tech #innovation\" and submit it.",
    "profile": "linkedin",
    "max_steps": 50
  }'
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check |
| `GET` | `/status` | Task queue status |
| `POST` | `/api/run` | Run a browser automation task |
| `POST` | `/api/navigate` | Open URL for manual VNC login |
| `POST` | `/api/session/save` | Persist cookies after manual login |
| `GET` | `/api/cookies?domain=` | Check session state |
| `POST` | `/api/browser/reset` | Clear all cookies and restart |

## n8n Workflow: Weekly LinkedIn Auto-Post

Import this JSON into n8n to set up the weekly post workflow. Replace the content and image URL in the HTTP Request node.

```json
{
  "name": "LinkedIn Weekly Auto-Post",
  "nodes": [
    {
      "name": "Weekly Schedule",
      "type": "n8n-nodes-base.scheduleTrigger",
      "typeVersion": 1,
      "position": [250, 300],
      "parameters": {
        "rule": {
          "interval": [{"field": "week", "hoursInterval": 168}]
        }
      }
    },
    {
      "name": "Generate Post Image",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [450, 300],
      "parameters": {
        "method": "POST",
        "url": "http://huggingface-flux:5000/generate",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {"name": "prompt", "value": "Professional LinkedIn post banner with modern tech theme, gradient blue background, subtle geometric patterns"},
            {"name": "width", "value": 1200},
            {"name": "height", "value": 627}
          ]
        }
      }
    },
    {
      "name": "Upload Image",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [650, 300],
      "parameters": {
        "method": "POST",
        "url": "http://image-upload:8001/upload",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {"name": "file", "value": "={{ $json.binaryData }}"}
          ]
        }
      }
    },
    {
      "name": "Stealth Browser - LinkedIn Post",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4,
      "position": [850, 300],
      "parameters": {
        "method": "POST",
        "url": "http://stealth-browser:8001/api/run",
        "sendBody": true,
        "bodyParameters": {
          "parameters": [
            {
              "name": "task",
              "value": "Go to linkedin.com/feed. Wait 5 seconds. Look for 'Start a post' button and click it. Wait 3 seconds. Type this in the editor: \"{{ $json.content }}\". Upload image from /app/uploads/{{ $json.filename }}. Wait 2 seconds. Click Post. Confirm it posted."
            },
            {"name": "profile", "value": "linkedin"},
            {"name": "max_steps", "value": 50}
          ]
        }
      }
    },
    {
      "name": "Success Notification",
      "type": "n8n-nodes-base.noOp",
      "typeVersion": 1,
      "position": [1050, 300],
      "parameters": {}
    }
  ],
  "connections": {
    "Weekly Schedule": {
      "main": [[{"node": "Generate Post Image", "type": "main", "index": 0}]]
    },
    "Generate Post Image": {
      "main": [[{"node": "Upload Image", "type": "main", "index": 0}]]
    },
    "Upload Image": {
      "main": [[{"node": "Stealth Browser - LinkedIn Post", "type": "main", "index": 0}]]
    },
    "Stealth Browser - LinkedIn Post": {
      "main": [[{"node": "Success Notification", "type": "main", "index": 0}]]
    }
  }
}
```

## Anti-Detection Techniques Used

1. **`navigator.webdriver`** → set to `undefined` (not `false` — real browsers don't have it)
2. **`navigator.plugins`** → spoofed with real Chrome plugin names
3. **`navigator.languages`** → set to `['en-US', 'en']`
4. **`window.chrome`** → full chrome.runtime object (headless Chrome lacks this)
5. **WebGL vendor/renderer** → masked as "Intel Inc."
6. **Canvas fingerprint** → slight pixel noise to avoid exact matching
7. **Hardware concurrency** → set to 8 (standard for modern machines)
8. **Permissions API** → returns 'prompt' instead of 'denied'
9. **Connection** → spoofed as 4G with realistic RTT/downlink
10. **User agent rotation** → real Chrome UAs, consistent per session
11. **Viewport** → standard monitor sizes, consistent per session
12. **Timezone/locale** → realistic, matched to target audience
13. **Human delays** → beta-distributed timing, not uniform random
14. **Typing simulation** → variable speed, typos, mid-word pauses
15. **Mouse movement** → bezier curve interpolation
16. **Scrolling** → acceleration/deceleration curves

## Ports

| Port | Service | Notes |
|---|---|---|
| `8001` | API | n8n HTTP Request targets this |
| `6081` | noVNC | Web-based VNC viewer → `http://host:6081/vnc.html` |
| `5901` | VNC | Raw VNC protocol for any VNC client |
