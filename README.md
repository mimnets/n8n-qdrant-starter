# n8n + Qdrant + Browser Use AI Stack 🚀

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Production-ready AI automation stack with n8n, Qdrant vector database, and self-hosted Browser Use for AI-powered browser automation.

## 📖 Overview

A self-hosted AI automation stack combining **[n8n](https://n8n.io)** workflow automation, **[Qdrant](https://qdrant.tech)** vector database, and **[Browser Use](https://browser-use.com)** for AI-driven browser tasks.

Perfect for: OCI free tier, budget VPS, and homelab servers.

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  PostgreSQL  │◄────│     n8n      │────►│   Qdrant    │
│  (metadata)  │     │ (automation) │     │  (vectors)  │
│    :5432     │     │    :5678     │     │   :6333     │
└──────────────┘     └──────┬───────┘     └─────────────┘
                            │
                            │ HTTP Request nodes
                            ▼
                     ┌──────────────┐     ┌─────────────────┐
                     │ browser-api  │     │  browser-webui  │
                     │ (FastAPI)    │     │  (Gradio + VNC) │
                     │   :8000      │     │  :7788 / :6080  │
                     └──────┬───────┘     └─────────────────┘
                            │
                            │ wraps
                            ▼
                     ┌──────────────┐
                     │  browser-use │
                     │  + Chromium  │
                     └──────────────┘
```

- **PostgreSQL 16** — n8n workflow metadata, credentials, execution history
- **n8n** — workflow automation engine with 400+ integrations
- **Qdrant** — vector database for semantic search, RAG, and AI memory
- **browser-api** — REST API bridge. n8n calls this to run browser tasks programmatically
- **browser-webui** — Gradio interface for manual browser automation with live VNC view

## ⚠️ Important

**The default `.env` values are placeholders.** If you don't replace them before starting the stack, n8n will fail to run — the encryption key and JWT secret must be properly generated 64-character hex strings. Run `./scripts/setup.sh` to generate secure values automatically, or manually generate them:

```bash
openssl rand -hex 32  # for N8N_ENCRYPTION_KEY and N8N_USER_MANAGEMENT_JWT_SECRET
```

Also replace `POSTGRES_PASSWORD` with a strong password of your own, and set at least one LLM API key for Browser Use.

## 🚀 Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/mimnets/n8n-qdrant-starter.git
cd n8n-qdrant-starter

# 2. Clone the Browser Use API bridge
git clone https://github.com/hoangnb24/browser-n8n-local.git

# 3. Run setup (creates .env with secure keys + required directories)
./scripts/setup.sh

# 4. Edit .env — add at least one LLM API key (DeepSeek, OpenAI, or Anthropic)
nano .env

# 5. Start the stack
docker compose up -d
```

Access n8n at **[http://localhost:5678](http://localhost:5678)**, Qdrant at **[http://localhost:6333](http://localhost:6333)**, Browser Use WebUI at **[http://localhost:7788](http://localhost:7788)**, and live browser view at **[http://localhost:6080/vnc.html](http://localhost:6080/vnc.html)** (password: `vncpassword`).

## 📋 Requirements

| Requirement | Minimum |
|------------|---------|
| Docker | 20.10+ |
| Docker Compose | v2+ |
| RAM | 8 GB (16 GB recommended) |
| Disk | 20 GB free |
| LLM API Key | DeepSeek, OpenAI, or Anthropic |

## 🗄️ Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `postgres` | `postgres:16-alpine` | `5432` (internal) | n8n metadata & workflow storage |
| `n8n` | `n8nio/n8n:latest` | `5678` | Workflow automation engine |
| `qdrant` | `qdrant/qdrant:latest` | `6333` | Vector database for AI embeddings |
| `browser-api` | *built from `./browser-n8n-local`* | `8000` | REST API for n8n → browser automation |
| `browser-webui` | `ghcr.io/browser-use/web-ui:main` | `7788`, `6080` | Manual browser AI + VNC live view |

## 🤖 Browser Use — Self-Hosted AI Browser Automation

Browser Use lets AI agents control a real web browser to perform tasks like web scraping, form filling, data extraction, and automated browsing. This stack includes **two components**:

### browser-api (`:8000`) — REST API for n8n

A FastAPI bridge that exposes a clean REST API for n8n workflows. Call it from n8n's **HTTP Request node**.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/v1/run-task` | Start a browser task |
| `GET` | `/api/v1/task/{id}` | Get full task details |
| `GET` | `/api/v1/task/{id}/status` | Check task status |
| `PUT` | `/api/v1/stop-task/{id}` | Stop a running task |
| `PUT` | `/api/v1/pause-task/{id}` | Pause a running task |
| `PUT` | `/api/v1/resume-task/{id}` | Resume a paused task |
| `GET` | `/api/v1/list-tasks` | List all tasks |
| `GET` | `/api/v1/task/{id}/media` | Get screenshots/PDFs from task |
| `GET` | `/api/v1/ping` | Health check |
| `GET` | `/live/{id}` | Live view page for a task |

### browser-webui (`:7788`) — Manual Browser Control

A Gradio-based WebUI where you type natural-language instructions and watch the browser execute them. Includes noVNC at `:6080` for real-time visual monitoring (password from `VNC_PASSWORD` env var).

## 🔗 Using Browser Use from n8n Workflows

### Example: Run a task and get results

**1. Start a task** — HTTP Request node:
```
Method: POST
URL: http://browser-api:8000/api/v1/run-task
Body (JSON): { "task": "Go to github.com, find the top 3 trending repositories today, and return their names and stars", "ai_provider": "deepseek" }
```

Response: `{ "id": "abc-123", "status": "created", "live_url": "/live/abc-123" }`

**2. Poll for completion** — HTTP Request node (in a loop):
```
Method: GET
URL: http://browser-api:8000/api/v1/task/{{ $json.id }}/status
```

Combine with a **Wait node** (5 seconds) and an **IF node** to check if `status` is `finished`. Loop until complete.

**3. Get the result** — the `status` endpoint returns:
```json
{ "status": "finished", "result": "1. repo-name — 1,234 stars\\n2. ..." }
```

### Example: Run a task using DeepSeek as the LLM

```
POST http://browser-api:8000/api/v1/run-task
Body: { "task": "Go to example.com, take a screenshot, and extract all heading texts", "ai_provider": "openai" }
```

> **Note:** DeepSeek is used by setting `OPENAI_BASE_URL=https://api.deepseek.com/v1` and `OPENAI_MODEL_ID=deepseek-chat` in `.env`, then using `"ai_provider": "openai"` in the API call (since DeepSeek is OpenAI-API compatible).

### Supported AI Providers

Set the `ai_provider` field in your API request to one of: `openai`, `anthropic`, `mistral`, `google`, `ollama`, `azure`. Configure the corresponding API keys in `.env`.

## 🔗 Using Qdrant in n8n

Qdrant is on the internal `ai-starter` network. From n8n workflows, connect via:

```
Host: qdrant
Port: 6333
URL: http://qdrant:6333
```

**HTTP Request node example:**
```
GET http://qdrant:6333/collections
```

For the full Qdrant API, see the [Qdrant REST docs](https://qdrant.tech/documentation/interfaces/#rest).

## 🤖 Adding AI Capabilities

Use cloud AI providers via n8n's built-in AI nodes or HTTP Request nodes:

### OpenAI
Set `OPENAI_API_KEY` in `.env`, then use the **OpenAI** node in n8n for embeddings, chat completions, and image generation.

### Anthropic (Claude)
Set `ANTHROPIC_API_KEY` in `.env`, use the **Anthropic** node or HTTP Request node:

```json
POST https://api.anthropic.com/v1/messages
Headers: x-api-key: YOUR_KEY, anthropic-version: 2023-06-01
```

### Cohere
Set `COHERE_API_KEY` in `.env`, use the **Cohere** node for embeddings and text generation.

### RAG Flow Example
1. **HTTP Request node** → Send text to OpenAI/Cohere embeddings API
2. **HTTP Request node** → Store vectors in Qdrant (`PUT /collections/my-collection/points`)
3. **HTTP Request node** → Search Qdrant (`POST /collections/my-collection/points/search`)
4. **AI node** → Send context + query to Claude/GPT for final answer

## 💾 Backup & Restore

```bash
# Create a full backup (PostgreSQL + n8n + Qdrant)
./scripts/backup.sh

# Manual restore
tar -xzf backups/backup_TIMESTAMP/n8n_data.tar.gz
docker compose exec -T postgres psql -U n8n n8n < backups/backup_TIMESTAMP/postgres_dump.sql
```

Backups are stored in `./backups/` (gitignored).

## 🔒 Security Notes

- **Change all default passwords** in `.env` before production use
- Set strong `N8N_ENCRYPTION_KEY` and `N8N_USER_MANAGEMENT_JWT_SECRET` (setup script generates these automatically)
- n8n is exposed on `0.0.0.0:5678` — use a reverse proxy (nginx, Caddy) with HTTPS for production
- Qdrant has no built-in auth — keep it on the internal Docker network or use a reverse proxy with auth
- Change `VNC_PASSWORD` from the default `vncpassword` in `.env`
- Never commit `.env` to version control (it's in `.gitignore`)

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Port 5678 already in use** | Change port mapping in `docker-compose.yml`: `"5679:5678"` |
| **n8n won't start** | Check logs: `docker compose logs n8n` |
| **Database connection refused** | Ensure PostgreSQL is healthy: `docker compose ps postgres` |
| **Permission denied on scripts** | Run `chmod +x scripts/*.sh` |
| **password authentication failed for user "n8n"** | Stale Postgres volume with an old password. Wipe and restart: `docker compose down -v && docker compose up -d` |
| **Browser API won't start** | Check logs: `docker compose logs browser-api`. Ensure at least one LLM API key is set in `.env` |
| **Browser tasks time out** | Complex tasks may need more time. Add a longer timeout in your n8n HTTP Request node |
| **Out of memory** | Browser Use runs a full Chromium browser. Ensure you have at least 8 GB RAM, or reduce `BROWSER_RESOLUTION` to `1280x720x24` |

## 📁 Project Structure

```
n8n-qdrant-starter/
├── .env.example          # Environment template
├── .gitignore            # Git ignore rules
├── docker-compose.yml    # Service orchestration
├── README.md             # This file
├── LICENSE               # MIT License
├── scripts/
│   ├── setup.sh          # First-run setup wizard
│   └── backup.sh         # Backup all services
├── browser-n8n-local/    # Browser Use API bridge (cloned)
│   ├── Dockerfile
│   ├── app.py            # FastAPI server
│   └── requirements.txt
└── n8n/
    └── demo-data/        # Drop demo workflow JSON files here
        └── .gitkeep
```

## 🙏 Credits & Acknowledgements

This project combines several outstanding open-source projects:

| Project | Repository | License |
|---------|------------|---------|
| **n8n** | [n8n-io/n8n](https://github.com/n8n-io/n8n) | Sustainable Use License |
| **Qdrant** | [qdrant/qdrant](https://github.com/qdrant/qdrant) | Apache 2.0 |
| **Browser Use** | [browser-use/browser-use](https://github.com/browser-use/browser-use) | MIT |
| **Browser Use Web-UI** | [browser-use/web-ui](https://github.com/browser-use/web-ui) | MIT |
| **browser-n8n-local** | [hoangnb24/browser-n8n-local](https://github.com/hoangnb24/browser-n8n-local) | MIT |

The `browser-api` service in this stack is powered by **[browser-n8n-local](https://github.com/hoangnb24/browser-n8n-local)** by [@hoangnb24](https://github.com/hoangnb24) (also [@henry0hai](https://github.com/henry0hai)), which provides the FastAPI bridge that emulates the Browser Use Cloud API locally, enabling n8n to trigger browser automation tasks via simple HTTP requests.

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

**n8n + Qdrant + Browser Use. Fully self-hosted AI automation.**
