# n8n + Qdrant + Browser Automation Stack 🚀

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Production-ready AI automation stack with n8n, Qdrant vector database, and
> AI-powered browser automation — all self-hosted.

## 📖 Overview

A lightweight, self-hosted stack combining:

- **[n8n](https://n8n.io)** — workflow automation engine (400+ integrations)
- **[Qdrant](https://qdrant.tech)** — vector database for semantic search, RAG, and AI memory
- **[Browser Use](https://github.com/browser-use/browser-use)** — AI agent that controls a real web browser
- **[Browser Use WebUI](https://github.com/browser-use/web-ui)** — human-facing Gradio interface with live noVNC view

Perfect for OCI free tier, budget VPS, and homelab servers.

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  PostgreSQL  │◄────│     n8n      │────►│   Qdrant    │
│  (metadata)  │     │ (automation) │     │  (vectors)  │
└──────────────┘     └──────┬───────┘     └─────────────┘
      :5432                 │                   :6333
                            │
              ┌─────────────┴─────────────┐
              │                           │
    ┌─────────┴─────────┐     ┌──────────┴──────────┐
    │   Browser API     │     │   Browser WebUI     │
    │   (REST bridge)   │     │   (Gradio + noVNC)  │
    │   :8001 (host)    │     │   :7788 / :6080     │
    └───────────────────┘     └─────────────────────┘
```

- **browser-api** — REST API that n8n calls via HTTP Request nodes to run browser
  automation tasks. Built directly on the `browser-use` Agent library.
- **browser-webui** — Human-facing Gradio UI for manually running browser tasks,
  with noVNC live browser view at port `:6080`.

## ⚠️ Important

**The default `.env` values are placeholders.** Run `./scripts/setup.sh` to
generate secure values, then edit `.env` and set at least one LLM API key:

```bash
DEEPSEEK_API_KEY=sk-your-deepseek-key    # budget-friendly
# or
OPENAI_API_KEY=sk-your-openai-key        # best reliability for browser-use
# or
ANTHROPIC_API_KEY=sk-ant-your-anthropic-key
```

> **💡 Tip:** `gpt-4o` (OpenAI) works flawlessly with browser-use. `deepseek-chat` sometimes
> struggles with function calling — use `deepseek-reasoner` or switch to OpenAI for best results.
> Set `DEFAULT_AI_PROVIDER` in `.env` to skip specifying it in every API call:
> ```bash
> DEFAULT_AI_PROVIDER=openai
> ```

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/mimnets/n8n-qdrant-starter.git
cd n8n-qdrant-starter

# 2. Setup (generates .env with secure keys)
./scripts/setup.sh

# 3. Edit .env — add your LLM API key + change passwords
nano .env

# 4. Start
docker compose up -d

# 5. Build and start the browser services
docker compose up -d --build browser-api browser-webui
```

## 🗄️ Services

| Service | Image / Build | Port (host) | Description |
|---------|---------------|-------------|-------------|
| `postgres` | `postgres:16-alpine` | `5432` *(internal)* | n8n metadata & workflow storage |
| `n8n` | `n8nio/n8n:latest` | `5678` | Workflow automation engine |
| `qdrant` | `qdrant/qdrant:latest` | `6333` | Vector database for AI embeddings |
| `browser-api` | *built from `./browser_api`* | `7999` | Persistent browser API for n8n (port 8001 used by Portainer) |
| `browser-webui` | *built from official repo* | `7788` | Gradio UI for manual browser tasks |
| | | `6080` | noVNC — live browser view |
| | | `5901` | VNC — direct connection |
| | | `9222` | Chrome DevTools Protocol |

## 🤖 Browser Automation

### From n8n workflows

Use the **HTTP Request node** — one call, returns result directly (blocking):

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

#### With logins (sensitive data)

```json
{
  "task": "Log in with {{email}} and {{password}}, then check notifications",
  "sensitive_data": {"email": "you@example.com", "password": "s3cret"}
}
```

#### Other endpoints

| Endpoint | Use |
|----------|-----|
| `GET /health` | Health check |
| `GET /api/providers` | Check which LLMs are configured |
| `POST /api/browser/reset` | Clear cookies + fresh browser session |

#### Cookie persistence

Cookies are saved to `./browser_profile/cookies.json` after each task and
survive container restarts. Login once, stay logged in.

### From the WebUI

Open `http://your-server:7788` — a chat-like interface where you type
instructions and watch the browser execute them live at
`http://your-server:6080/vnc.html` (password from `VNC_PASSWORD` in `.env`).

### Supported LLM providers

| Provider | `.env` key | `ai_provider` value |
|----------|-----------|---------------------|
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek` |
| OpenAI | `OPENAI_API_KEY` | `openai` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic` |
| Google Gemini | `GOOGLE_API_KEY` | `google` |
| Mistral | `MISTRAL_API_KEY` | `mistral` |
| Ollama (local) | *(no key needed)* | `ollama` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY` | `azure` |

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

## 🔒 Security Notes

- **Change all default passwords** in `.env` before production use
- Set strong `N8N_ENCRYPTION_KEY` and `N8N_USER_MANAGEMENT_JWT_SECRET`
- n8n is exposed on `0.0.0.0:5678` — use a reverse proxy (nginx, Caddy) with HTTPS
- Qdrant has no built-in auth — keep on internal Docker network
- Never commit `.env` (it's gitignored)

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Port already in use** | Change port mapping in `docker-compose.yml` |
| **n8n won't start** | Check logs: `docker compose logs n8n` |
| **Browser API build fails** | Ensure `browser_api/` directory exists, check `docker compose logs browser-api` |
| **browser-webui pull denied** | Builds from GitHub source — no registry auth needed |
| **noVNC can't connect** | Wait ~30s for VNC server to start; check password |
| **Browser task hangs** | Try `"max_steps": 30` — complex pages may need more steps |

## 📁 Project Structure

```
n8n-qdrant-starter/
├── .env.example              # Environment template
├── .gitignore
├── docker-compose.yml        # All services
├── README.md
├── LICENSE                   # MIT
├── scripts/
│   ├── setup.sh              # First-run setup
│   ├── n8n-entrypoint.sh     # n8n container entrypoint
│   └── backup.sh             # Backup all services
├── browser_api/              # Persistent browser REST API
│   ├── server.py             # Single-file FastAPI app
│   ├── Dockerfile
│   ├── requirements.txt
│   └── browser_profile/      # Cookie persistence (auto-saved)
└── n8n/
    └── demo-data/            # Drop demo workflow JSON files here
```

## 🙏 Credits

The browser automation components in this stack are inspired by and built upon
the excellent work of the **[Browser Use](https://github.com/browser-use)** project:

- **[browser-use](https://github.com/browser-use/browser-use)** — the core Python
  library that gives AI agents the ability to control a real web browser via
  Playwright. Licensed under MIT.

- **[browser-use/web-ui](https://github.com/browser-use/web-ui)** — the official
  Gradio-based WebUI with noVNC live browser view. Our `browser_api/` REST bridge
  follows the same Agent integration patterns and uses the same underlying
  `browser_use.Agent` API. Licensed under MIT.

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
