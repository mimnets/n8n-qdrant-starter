# n8n + Qdrant + Stealth Browser Automation Stack 🚀

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Production-ready AI automation stack — n8n workflows, Qdrant vector search,
> **stealth browser** with full anti-detection for LinkedIn/Facebook, and self-hosted
> image upload. All images pulled from Docker Hub — no local builds needed.

## 📖 Overview

A lightweight, self-hosted stack combining:

- **[n8n](https://n8n.io)** — workflow automation engine (400+ integrations)
- **[Qdrant](https://qdrant.tech)** — vector database for semantic search, RAG, and AI memory
- **[Stealth Browser API](https://hub.docker.com/r/mimnets/stealth-browser-api)** — anti-detection Playwright service with VNC for LinkedIn/Facebook posting
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
    │ Stealth      │  │ Image Upload  │  │
    │ Browser API  │  │ (REST, 8010)  │  │
    │ (REST, 8001) │  │ imgbb repl.   │  │
    │ VNC :6081    │  └───────────────┘  │
    └──────────────┘                     │
```

- **Stealth Browser API** — Single container with 16 anti-detection patches, human-like behavior (bezier mouse curves, typing with typos, randomized delays), persistent per-site profiles. n8n sends a task via HTTP, the API drives Chromium to complete it. Includes **VNC** for watching/interacting live.
- **Image Upload API** — Single container. n8n uploads images via HTTP, gets back a public URL for downstream workflow steps.

## 🆕 What's New

This stack replaces the old `browser-use-api` with a purpose-built **stealth-browser**:

| Feature | Old browser-api | New stealth-browser |
|---------|----------------|---------------------|
| Anti-detection | `--disable-blink-features=AutomationControlled` only | 16 stealth patches — webdriver undefined, chrome.runtime, WebGL mask, canvas noise, etc. |
| Human behavior | AI moves at machine speed | Beta-distributed delays, human typing with typos & mid-word pauses, bezier mouse curves |
| Profiles | Cookie JSON only (loses localStorage/IndexedDB) | Full Chromium user_data_dir — preserves everything |
| Fingerprint | Random every run | Consistent UA/locale/viewport/timezone per session profile |
| Sites | General browsing | Optimized for LinkedIn, Facebook, and high-security sites |

## ⚠️ Prerequisites

**No LLM API key required** for the stealth browser — it uses Playwright directly (click-based, not AI vision). If you want AI-powered browsing (describing tasks in plain English), set at least one LLM key in `.env`:

```bash
OPENAI_API_KEY=sk-your-key            # most reliable
# or
DEEPSEEK_API_KEY=sk-your-key           # budget-friendly
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

# 4. Start everything (all images pulled from Docker Hub)
docker compose up -d

# 5. Check all services are healthy
docker compose ps
```

| Access | URL |
|--------|-----|
| **n8n** | `http://localhost:5678` |
| **Stealth Browser API** | `http://localhost:8001` |
| **VNC (browser live view)** | `http://localhost:6081/vnc.html` |
| **Qdrant Dashboard** | `http://localhost:6333/dashboard` |
| **Image Upload API** | `http://localhost:8010` |

## 🗄️ Services

| Service | Image | Port (host) | Health |
|---------|-------|-------------|--------|
| `postgres` | `postgres:16-alpine` | `5432` *(internal)* | ✅ healthcheck |
| `n8n` | `n8nio/n8n:latest` | `5678` | ✅ healthcheck |
| `qdrant` | `qdrant/qdrant:latest` | `6333` | ✅ |
| `stealth-browser` | `mimnets/stealth-browser-api:latest` | `8001`, `6081` (VNC), `5901` (VNC) | ✅ healthcheck |
| `image-upload` | `mimnets/n8n-image-upload:latest` | `8010` | ✅ healthcheck |

### Stealth Browser Docker image

| Detail | Value |
|--------|-------|
| Registry | Docker Hub |
| Image | `mimnets/stealth-browser-api:latest` |
| Base | `mcr.microsoft.com/playwright:v1.46.0-jammy` |
| Engine | **AI Agent** — vision-based LLM drives the browser (supports OpenAI, DeepSeek, Anthropic, Google) |
| Browser | Chromium (matches base image) |
| Anti-detection | 16 stealth patches — webdriver, chrome.runtime, WebGL, canvas, fonts, etc. |
| Human behavior | Bezier mouse curves, randomized delays, typing with typos |
| Profiles | Full Chromium user_data_dir per profile (cookies + localStorage + IndexedDB) |
| VNC | noVNC web client on `:6081`, raw VNC on `:5901` |
| Session persistence | Saved per-profile via `/api/session/save` |

## 🖥️ VNC — Watch & Interact with the Browser

The stealth-browser container includes a full VNC server — watch the automation and **interact manually** via mouse and keyboard.

### Access

| Method | URL | Notes |
|--------|-----|-------|
| **noVNC (web)** | `http://localhost:6081/vnc.html` | Browser-based, no client needed |
| **Raw VNC** | `localhost:5901` | Any VNC client (RealVNC, TightVNC, etc.) |
| **Remote** | `http://<server-ip>:6081/vnc.html` | From any device on the network |

No password by default. Set `VNC_PASSWORD` in `.env` to add authentication.

### One-time LinkedIn/Facebook login via VNC

For sites that require login, you log in once manually and save the session:

```bash
# 1. Open the login page via API
curl -X POST http://localhost:8001/api/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.linkedin.com/login", "profile": "linkedin"}'

# 2. Open VNC → http://localhost:6081/vnc.html → log in manually

# 3. Save the session
curl -X POST http://localhost:8001/api/session/save \
  -H "Content-Type: application/json" \
  -d '{"profile": "linkedin"}'
```

After saving, all future automation tasks use the saved session automatically.

## 🔧 Stealth Browser API Endpoints

### GET `/health`
Server health check.
```bash
curl http://localhost:8001/health
# → {"status":"ok","browser_running":false,"busy":false}
```

### GET `/status`
Detailed status — browser state, VNC URL, profiles.
```bash
curl http://localhost:8001/status
```

### POST `/api/navigate`
Open a URL and keep the browser alive for VNC interaction. No AI — just opens the page.
```json
{
  "url": "https://linkedin.com/login",
  "profile": "linkedin"
}
```

### POST `/api/session/save`
Save the current browser session (cookies + storage) to a named profile.
```json
{
  "profile": "linkedin"
}
```

### POST `/api/run`
Execute a browser automation task using the AI agent (vision-based — the LLM sees the page and decides what to click).
```json
{
  "task": "Go to the LinkedIn company page admin dashboard and post the article content",
  "profile": "linkedin",
  "max_steps": 30,
  "llm_provider": "openai",
  "pause_on_captcha": true
}
```

| Field | Description | Default |
|-------|-------------|---------|
| `task` | Plain English description of what to do | _(required)_ |
| `profile` | Browser profile to use (saved sessions) | `"default"` |
| `url` | Starting URL (optional — or include in task) | `null` |
| `max_steps` | Maximum AI steps before returning | `30` |
| `llm_provider` | LLM to drive the browser: `openai`, `deepseek`, `anthropic`, `google` | `"openai"` |
| `pause_on_captcha` | Pause task if CAPTCHA is detected | `false` |

> ⚠️ You must have an LLM API key in `.env` for the AI agent to work. OpenAI (`gpt-4o`) is recommended.

### GET `/api/cookies`
Check if a domain has active cookies (login check).
```
GET /api/cookies?domain=linkedin.com
```

### POST `/api/browser/reset`
Reset the browser — clears everything, starts fresh.

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

### Check login session → run task

```
1. HTTP Request → GET http://stealth-browser:8001/api/cookies?domain=linkedin.com
2. IF node → has_session == true?
   - YES: HTTP Request → POST http://stealth-browser:8001/api/run (your task)
   - NO:  Alert / VNC login required
```

### Post to LinkedIn

```json
POST http://stealth-browser:8001/api/run
Content-Type: application/json

{
  "task": "Post to LinkedIn feed with content: \"Check out our latest update!\"",
  "profile": "linkedin"
}
```

### Post to Facebook

```json
POST http://stealth-browser:8001/api/run
Content-Type: application/json

{
  "task": "Create a Facebook post saying: \"Hello world from automation!\"",
  "profile": "facebook"
}
```

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **stealth-browser unhealthy** | `docker compose logs stealth-browser` — check for Playwright errors |
| **VNC shows blank screen** | The browser window may be positioned off-screen. Run: `docker exec stealth-browser apt-get install -y wmctrl && docker exec -e DISPLAY=:99 stealth-browser wmctrl -r "LinkedIn" -e 0,0,0,1920,1080` |
| **Executable doesn't exist** | Run `docker compose build --no-cache stealth-browser` and `docker compose up -d` to rebuild with matching Playwright versions |
| **n8n can't reach stealth-browser** | Use `http://stealth-browser:8001` (Docker network name, not localhost) |
| **Session not persisting** | Log in via VNC first, then call `/api/session/save` |
| **Port already in use** | Change host ports in `docker-compose.yml` |
| **Image Upload admin not working** | Hard refresh: **Ctrl+Shift+R** |

## 🔒 Security Notes

- **Change all default passwords** in `.env` before production use
- Set strong `N8N_ENCRYPTION_KEY` and `N8N_USER_MANAGEMENT_JWT_SECRET`
- Use a reverse proxy (nginx, Caddy) with HTTPS for production
- Never commit `.env` (it's gitignored)
- Set `VNC_PASSWORD` to protect VNC access
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
| `6081` | noVNC (stealth browser live view) |
| `8001` | Stealth Browser API |
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
├── stealth-browser/          # Source for the stealth-browser Docker image
│   ├── Dockerfile
│   ├── supervisord.conf
│   ├── requirements.txt
│   └── src/
│       ├── main.py           # FastAPI server
│       ├── browser.py        # Browser lifecycle + profiles
│       ├── stealth.py        # 16 anti-detection patches
│       ├── humanize.py       # Human-like behavior
│       ├── cookie_manager.py # Per-profile save/load
│       └── session_manager.py# Task queue + concurrency
└── image-upload-server/      # Source for the image-upload Docker image
```

## 🐳 Docker Hub

| Repository | Description | Pull |
|------------|-------------|------|
| `mimnets/stealth-browser-api` | Anti-detection browser automation | `docker pull mimnets/stealth-browser-api:latest` |
| `mimnets/n8n-image-upload` | Self-hosted image upload | `docker pull mimnets/n8n-image-upload:latest` |
