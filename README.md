# n8n + Qdrant + Browser Automation Stack 🚀

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Production-ready AI automation stack — n8n workflows, Qdrant vector search,
> AI-powered browser automation with VNC, and self-hosted image upload.
> All images pulled from Docker Hub — no local builds needed.

## 📖 Overview

A lightweight, self-hosted stack combining:

- **[n8n](https://n8n.io)** — workflow automation engine (400+ integrations)
- **[Qdrant](https://qdrant.tech)** — vector database for semantic search, RAG, and AI memory
- **[Browser Use API](https://hub.docker.com/r/mimnets/browser-use-api)** — persistent browser agent with VNC that n8n controls via HTTP
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
    │ Browser API  │  │ Image Upload  │  │
    │ (REST, 7999) │  │ (REST, 8010)  │  │
    │ VNC :6080    │  │ imgbb repl.   │  │
    └──────────────┘  └───────────────┘  │
```

- **Browser Use API** — Single container. n8n sends a task description via HTTP,
  the API runs a real Chromium browser to complete it, and returns the result.
  Browser stays alive between calls — cookies and login sessions persist.
  Includes **VNC** for watching the browser live.
- **Image Upload API** — Single container. n8n uploads images via HTTP,
  gets back a public URL for downstream workflow steps.

## ⚠️ Prerequisites

**Set at least one LLM API key** in `.env` before starting:

```bash
DEEPSEEK_API_KEY=sk-your-key          # budget-friendly (~$0.01/task)
# or
OPENAI_API_KEY=sk-your-key            # most reliable
# or
GOOGLE_API_KEY=your-free-gemini-key   # free tier (1,500 req/day)
```

> 💡 **Tip:** `gpt-4o` (OpenAI) works flawlessly. `deepseek-chat` sometimes
> struggles — use `deepseek-reasoner` for better results. Gemini is free.

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/mimnets/n8n-qdrant-starter.git
cd n8n-qdrant-starter

# 2. Create .env from the example
cp .env.example .env

# 3. Edit .env — add your LLM API key
nano .env

# 4. Start everything (all images pulled from Docker Hub)
docker compose up -d

# 5. Fix browser profile permissions (one-time — Docker mounts it as root)
chmod 777 ./browser_profile
```

| Access | URL |
|--------|-----|
| **n8n** | `http://localhost:5678` |
| **Browser API** | `http://localhost:7999` |
| **VNC (browser live view)** | `http://localhost:6080/vnc.html` |
| **Qdrant Dashboard** | `http://localhost:6333/dashboard` |
| **Image Upload API** | `http://localhost:8010` |

## 🗄️ Services

| Service | Image | Port (host) | Source |
|---------|-------|-------------|--------|
| `postgres` | `postgres:16-alpine` | `5432` *(internal)* | Docker Hub |
| `n8n` | `n8nio/n8n:latest` | `5678` | Docker Hub |
| `qdrant` | `qdrant/qdrant:latest` | `6333` | Docker Hub |
| `image-upload` | `mimnets/n8n-image-upload:latest` | `8010` | Docker Hub |
| `browser-api` | `mimnets/browser-use-api:latest` | `7999`, `6080` (VNC), `5900` (VNC) | Docker Hub |

### Browser API Docker image

| Detail | Value |
|--------|-------|
| Registry | Docker Hub |
| Image | `mimnets/browser-use-api:latest` |
| Base | `python:3.12-slim` |
| Engine | `browser-use` + Playwright Chromium |
| Browser | Persistent — stays alive between calls |
| VNC | noVNC web client on `:6080`, raw VNC on `:5900` |
| Cookies | Auto-saved to `./browser_profile/cookies.json` |

### Image Upload Docker image

| Detail | Value |
|--------|-------|
| Registry | Docker Hub |
| Image | `mimnets/n8n-image-upload:latest` |
| Base | `python:3.12-slim` |
| Framework | FastAPI + uvicorn |

## 🖥️ VNC — Watch & Interact with the Browser

The browser-api container includes a full VNC server — you can watch the AI
agent control the browser **and interact with it manually** via mouse and keyboard.

### Access

| Method | URL | Notes |
|--------|-----|-------|
| **noVNC (web)** | `http://localhost:6080/vnc.html` | Browser-based, no client needed |
| **Raw VNC** | `localhost:5900` | Any VNC client (RealVNC, TightVNC, etc.) |
| **Remote** | `http://<server-ip>:6080/vnc.html` | From any device on the network |

No password by default. Set `VNC_PASSWORD` in `.env` to add authentication.

> 💡 **Tip:** Keep noVNC open during n8n workflow development to debug
> browser automation tasks visually.

### Manual login via VNC — save credentials for automation

Need to log in to a website once so all future automated tasks skip the login?
Use `/api/navigate` — it opens the page and keeps the browser alive with **no AI agent**:

```bash
curl -X POST http://localhost:7999/api/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://linkedin.com/login", "wait_minutes": 10}'
```

What happens:
1. Browser opens and navigates to the URL (no AI — just Playwright)
2. Sleeps for `wait_minutes` — the page stays open and interactive via VNC
3. You log in manually through VNC
4. After the wait period, cookies auto-save
5. All future `/api/run` tasks have your session

Then:
1. Open `http://localhost:6080/vnc.html` — you'll see the browser at the login page
2. **Click into the VNC window** — your mouse and keyboard control the browser directly
3. Type in your credentials and log in
4. When the wait expires, **cookies auto-save to disk**
5. All future automated tasks reuse those cookies — no login needed

**Full n8n workflow pattern:**

```
Step 1: GET /api/cookies?domain=linkedin.com
            │
       ┌────┴────┐
       ▼         ▼
   has_session  no session
       │         │
       ▼         ▼
   Run your    HTTP Request:
   automation  POST /api/navigate
   task        {"url": "https://linkedin.com/login",
                 "wait_minutes": 10}
                  │
                  ▼
               Open VNC → manually login
                  │
                  ▼
               Cookies auto-save after wait expires
                  │
                  ▼
               Run your automation task
```

> 💡 **Tip:** `/api/navigate` doesn't use the LLM — it's just Playwright
> opening a URL and sleeping. Use it any time you need the browser to stay
> open for manual interaction via VNC.

## 🍪 Cookie & Session Persistence

The browser maintains state between tasks so you don't start from scratch each time.

### How it works

```
┌──────────────┐     ┌──────────────┐     ┌────────────────┐
│  Task runs   │────►│  Cookies     │────►│  Next task     │
│  (logs in,   │     │  auto-saved  │     │  loads cookies │
│   browses)   │     │  to disk     │     │  → stays in    │
└──────────────┘     └──────────────┘     └────────────────┘
```

1. Each task completes → all browser cookies saved to `./browser_profile/cookies.json`
2. Next task starts → cookies restored from disk
3. Container restarts → volume mount preserves `./browser_profile/`

### What persists

| Item | Persists? |
|------|-----------|
| Login sessions (cookies) | ✅ Yes |
| Local Storage | ✅ Yes (in browser profile) |
| Session Storage | ❌ No (cleared on browser restart) |
| Open tabs | ❌ No (fresh browser each task) |

### Reset the session

```bash
curl -X POST http://localhost:7999/api/browser/reset
```

Clears all cookies and starts fresh — like opening a new incognito window.

## 🖼️ Image Upload API

Self-hosted replacement for imgbb. n8n uploads an image, gets back a URL, and
uses that URL in the next workflow step.

### From n8n workflows

Typical pattern — three nodes in sequence:

```
┌──────────────────┐     ┌──────────────────────┐     ┌──────────────────┐
│ 1. Get image     │     │ 2. Upload to server   │     │ 3. Use the URL   │
│ (HTTP / AI /     │ ──► │ POST /upload           │ ──► │ (Browser API,    │
│  binary data)    │     │ → returns public URL   │     │  next form, etc) │
└──────────────────┘     └──────────────────────┘     └──────────────────┘
```

**Step 2 — HTTP Request node:**

```
POST http://image-upload:8001/upload
Body Type: Form-Data
  → file: {{ $json.binaryPropertyName }}  (mode: "From Binary Property")
```

Response:

```json
{
  "success": true,
  "filename": "20260618_143022_a1b2c3d4.png",
  "url": "http://image-upload:8001/images/20260618_143022_a1b2c3d4.png",
  "size_bytes": 245760,
  "content_type": "image/png"
}
```

### Viewing uploaded images

Each uploaded image gets a public URL. You can view it in your browser or use it
in any workflow step:

| Access from | URL format |
|-------------|------------|
| **Browser (host)** | `http://localhost:8010/images/{filename}` |
| **n8n / Docker network** | `http://image-upload:8001/images/{filename}` |
| **External (production)** | `https://your-domain.com/images/{filename}` *(requires BASE_URL)* |

To browse all uploaded images as JSON, hit the list endpoint with your API key:

```
GET http://localhost:8010/images?api_key=your_secret_key_here
```

Example response:
```json
{
  "images": [
    {"filename": "20260618_143022_a1b2c3d4.png", "url": "http://localhost:8010/images/20260618_143022_a1b2c3d4.png", "size_bytes": 245760},
    {"filename": "20260618_150130_d5e6f7g8.jpg", "url": "http://localhost:8010/images/20260618_150130_d5e6f7g8.jpg", "size_bytes": 128000}
  ],
  "count": 2,
  "total_size_bytes": 373760
}
```

### With API key (recommended for exposed ports)

```bash
# In .env
UPLOAD_API_KEY=your_secret_key_here
```

Then in the HTTP Request node, add `?api_key=your_secret_key_here` to the URL:

```
POST http://image-upload:8001/upload?api_key=your_secret_key_here
```

Or set an `X-API-Key` header.

### Admin panel

A built-in web UI for browsing, viewing, and deleting uploaded images:

```
http://localhost:8010/admin
```

If `UPLOAD_API_KEY` is set, pass it as a query parameter:

```
http://localhost:8010/admin?api_key=your_secret_key_here
```

The admin panel shows an image gallery with thumbnails, file sizes, upload dates,
and one-click delete. No separate database or tool needed.

### End-to-end example: screenshot → upload → submit to website

1. **Browser API node** — take a screenshot, get binary PNG back
2. **HTTP Request node** — `POST http://image-upload:8001/upload` with the PNG binary → returns `url`
3. **Browser API node** — task: `"Fill the image field with {{url}} and submit the form"`

### All endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/admin` | optional | Web-based admin panel — browse, view, delete images |
| `GET` | `/health` | no | Health check + file count |
| `POST` | `/upload` | optional | Upload an image (multipart/form-data, field `file`) |
| `GET` | `/images/{filename}` | no | Serve an uploaded image |
| `GET` | `/images` | yes | List all uploaded images (JSON) |
| `DELETE` | `/images/{filename}` | yes | Delete an uploaded image |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `UPLOAD_API_KEY` | *(empty)* | API key for protected endpoints. Empty = no auth. |
| `UPLOAD_MAX_FILE_SIZE_MB` | `10` | Max upload size in megabytes |
| `UPLOAD_BASE_URL` | *(auto)* | Public base URL for image links. Auto-detects from request if empty. |

## 🤖 Browser Automation

### From n8n workflows

One **HTTP Request node** — blocks until done, returns the result:

```
POST http://browser-api:8000/api/run
Content-Type: application/json

{
  "task": "Go to news.ycombinator.com and return the top 5 headlines",
  "llm_provider": "deepseek",
  "max_steps": 50
}
```

Response:

```json
{
  "success": true,
  "result": "1. Article A\n2. Article B...",
  "error": null,
  "steps_taken": 5
}
```

### With logins (sensitive data)

Use `{{variable}}` placeholders — values are masked in logs:

```json
{
  "task": "Log in with {{email}} and {{password}}, then check notifications",
  "sensitive_data": {"email": "you@example.com", "password": "s3cret"},
  "max_steps": 30
}
```

### All endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check → `{"status":"ok"}` |
| `POST` | `/api/run` | Run a task (blocks, returns result) |
| `POST` | `/api/browser/reset` | Clear cookies + fresh browser |
| `GET` | `/api/providers` | List configured LLM providers |
| `GET` | `/api/cookies` | List saved cookies (optional `?domain=`) |
| `POST` | `/api/navigate` | Open URL + keep browser alive for VNC login |

### Check session status before automation

Use the `/api/cookies` endpoint to verify you're logged in before running
automation tasks:

```bash
# List all saved cookies
curl http://localhost:7999/api/cookies

# Check if logged in to a specific site
curl http://localhost:7999/api/cookies?domain=example.com
```

Response:
```json
{
  "domain": "example.com",
  "has_session": true,
  "cookie_count": 4,
  "cookie_names": ["sessionid", "csrftoken", "remember_me", "user_prefs"]
}
```

**n8n workflow pattern:**

```
┌───────────────────┐
│ HTTP Request      │ GET /api/cookies?domain=example.com
│ Check session     │
└────────┬──────────┘
         │
    ┌────┴────┐
    │ IF node │ has_session == true ?
    └────┬────┘
         │
   ┌─────┴─────┐
   ▼           ▼
  true        false
   │           │
   ▼           ▼
Run auto    VNC login
tasks       task first
```

### Cookie persistence

Cookies are saved to `./browser_profile/cookies.json` after each task.
They survive container restarts — log in once, stay logged in across tasks.

### Supported LLM providers

| Provider | `.env` key | `llm_provider` value |
|----------|-----------|----------------------|
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek` |
| OpenAI | `OPENAI_API_KEY` | `openai` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic` |
| Google Gemini | `GOOGLE_API_KEY` | `google` |
| Mistral | `MISTRAL_API_KEY` | `mistral` |
| Ollama (local) | *(no key needed)* | `ollama` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | `azure` |

Check `/api/providers` to see which are currently configured.

## 🔗 Using Qdrant in n8n

Qdrant is on the internal `ai-starter` network. From n8n workflows:

```
Host: qdrant
Port: 6333
URL: http://qdrant:6333
```

### RAG Flow Example

1. **HTTP Request node** → send text to embedding API
2. **HTTP Request node** → store vectors in Qdrant (`PUT /collections/my-collection/points`)
3. **HTTP Request node** → search Qdrant (`POST /collections/my-collection/points/search`)
4. **AI node** → send context + query to LLM for final answer

## 💾 Backup & Restore

```bash
./scripts/backup.sh

# Manual restore
tar -xzf backups/backup_TIMESTAMP/n8n_data.tar.gz
docker compose exec -T postgres psql -U n8n n8n < backups/backup_TIMESTAMP/postgres_dump.sql
```

## ☁️ Cloud Server Deployment

All images support both `linux/amd64` and `linux/arm64` — works on AWS Graviton,
Raspberry Pi, OCI Ampere, Apple Silicon, and standard x86_64 servers.

### Quick deploy

```bash
git clone https://github.com/mimnets/n8n-qdrant-starter.git
cd n8n-qdrant-starter
cp .env.example .env
nano .env                              # Add your API keys
docker compose up -d
```

### Update running server

```bash
git pull
docker compose pull
docker compose up -d
```

### Firewall (OCI / AWS / GCP)

Open these ports in your cloud firewall + instance iptables:

| Port | Service |
|------|---------|
| `5678` | n8n web UI |
| `6080` | noVNC (browser live view) |
| `7999` | Browser API |
| `8010` | Image Upload API + admin panel |
| `6333` | Qdrant (internal only recommended) |

### OCI specific

```bash
# In OCI Console: Networking → VCN → Security Lists → Add Ingress Rules
# Then on the instance:
sudo iptables -I INPUT -p tcp --dport 8010 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 6080 -j ACCEPT
sudo netfilter-persistent save
```

## 🔒 Security Notes

- **Change all default passwords** in `.env` before production use
- Set strong `N8N_ENCRYPTION_KEY` and `N8N_USER_MANAGEMENT_JWT_SECRET`
- Use a reverse proxy (nginx, Caddy) with HTTPS for production
- Qdrant has no built-in auth — keep on internal Docker network
- Never commit `.env` (it's gitignored)
- `sensitive_data` values are masked in API logs
- Set `UPLOAD_API_KEY` if image-upload port is exposed publicly
- Set `VNC_PASSWORD` to protect VNC access

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Port already in use** | Change host ports in `docker-compose.yml` |
| **n8n won't start** | `docker compose logs n8n` — check `.env` has valid keys |
| **Browser API not responding** | `docker compose logs browser-api` |
| **VNC shows black screen** | A task must be running. Send a task first, then open VNC. |
| **VNC page loads but no interaction** | Click into the VNC window to capture mouse/keyboard |
| **Task returns error** | Check `http://localhost:7999/api/providers` — is your LLM configured? |
| **DeepSeek produces bad results** | Switch to `deepseek-reasoner` or OpenAI/Gemini |
| **Browser session stale** | `curl -X POST http://localhost:7999/api/browser/reset` |
| **Cookies not persisting** | Check `./browser_profile/` exists and is writable |
| **Image admin shows no images** | Check permissions: `docker compose exec image-upload ls -la /app/uploads` |
| **Image admin JS errors** | Hard refresh: **Ctrl+Shift+R** — browser may cache old page |
| **Cloud server can't connect** | Check cloud firewall AND instance iptables both have ports open |
| **Container exits on ARM64** | Run `docker compose pull` — images are multi-arch now |

## 📁 Project Structure

```
n8n-qdrant-starter/
├── .env.example              # Environment template
├── .env                      # Your config (gitignored)
├── .gitignore
├── docker-compose.yml        # All services (pull from Docker Hub)
├── README.md
├── LICENSE                   # MIT
├── scripts/
│   ├── n8n-entrypoint.sh     # n8n container entrypoint
│   ├── setup.sh              # First-run setup helper
│   └── backup.sh             # Backup all services
├── browser_profile/          # Browser cookies & session data (volume mount)
└── n8n/
    └── demo-data/            # Drop demo workflow JSON files here
```

> ⚡ **Lightweight by design.** All custom images are pulled from Docker Hub —
> no local Dockerfiles, no builds, no Python dependencies to install.
> Just `docker compose up -d` and you're running.

## 🛠️ Building From Source

The Docker images are pre-built on Docker Hub. If you need to modify and rebuild
them, the Dockerfiles and source code live in their own repositories:

- **Browser Use API:** [mimnets/browser-use-api](https://hub.docker.com/r/mimnets/browser-use-api)
- **Image Upload API:** [mimnets/n8n-image-upload](https://hub.docker.com/r/mimnets/n8n-image-upload)

To build locally, clone those repos, make changes, then update the image tag in
`docker-compose.yml` to use `build:` instead of `image:`.

## 🙏 Credits

- **[browser-use](https://github.com/browser-use/browser-use)** — core Python library
  that gives AI agents the ability to control a real browser via Playwright. MIT.
- **[browser-use-fastapi-docker-server](https://github.com/gauravdhiman/browser-use-fastapi-docker-server)** —
  reference FastAPI wrapper pattern by gauravdhiman.
- **[browser-use/web-ui](https://github.com/browser-use/web-ui)** — official Gradio
  WebUI whose Agent integration patterns inspired the API design. MIT.

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
