# n8n + Qdrant + Browser Automation Stack 🚀

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Production-ready AI automation stack — n8n workflows, Qdrant vector search,
> and AI-powered browser automation, all self-hosted.

## 📖 Overview

A lightweight, self-hosted stack combining:

- **[n8n](https://n8n.io)** — workflow automation engine (400+ integrations)
- **[Qdrant](https://qdrant.tech)** — vector database for semantic search, RAG, and AI memory
- **[Browser Use API](https://hub.docker.com/r/mimnets/browser-use-api)** — persistent browser agent that n8n controls via HTTP

## 🏗️ Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────┐
│  PostgreSQL  │◄────│     n8n      │────►│   Qdrant    │
│  (metadata)  │     │ (automation) │     │  (vectors)  │
└──────────────┘     └──────┬───────┘     └─────────────┘
      :5432                 │                   :6333
                            │
              ┌─────────────┴─────────────┐
              │    Browser Use API        │
              │    (REST, port 7999)      │
              │    Persistent browser     │
              │    Cookie persistence     │
              └───────────────────────────┘
```

- **Browser Use API** — Single container. n8n sends a task description via HTTP,
  the API runs a real Chromium browser to complete it, and returns the result.
  Browser stays alive between calls — cookies and login sessions persist.

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

# 2. Setup (generates .env with secure keys)
./scripts/setup.sh

# 3. Edit .env — add your LLM API key
nano .env

# 4. Start everything
docker compose up -d
```

Access **n8n** at `http://localhost:5678` and **Browser API** at `http://localhost:7999`.

## 🗄️ Services

| Service | Image | Port (host) | Description |
|---------|-------|-------------|-------------|
| `postgres` | `postgres:16-alpine` | `5432` *(internal)* | n8n metadata & workflow storage |
| `n8n` | `n8nio/n8n:latest` | `5678` | Workflow automation engine |
| `qdrant` | `qdrant/qdrant:latest` | `6333` | Vector database for AI embeddings |
| `browser-api` | `mimnets/browser-use-api:latest` | `7999` | Persistent browser agent API |

### Browser API Docker image

| Detail | Value |
|--------|-------|
| Registry | Docker Hub |
| Image | `mimnets/browser-use-api:latest` |
| Size | ~635 MB |
| Base | `python:3.12-slim` |
| Engine | `browser-use==0.1.48` + Playwright Chromium |
| Browser | Persistent — stays alive between calls |
| Cookies | Auto-saved to `./browser_profile/cookies.json` |

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

## 🔒 Security Notes

- **Change all default passwords** in `.env` before production use
- Set strong `N8N_ENCRYPTION_KEY` and `N8N_USER_MANAGEMENT_JWT_SECRET`
- Use a reverse proxy (nginx, Caddy) with HTTPS for production
- Qdrant has no built-in auth — keep on internal Docker network
- Never commit `.env` (it's gitignored)
- `sensitive_data` values are masked in API logs

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Port 7999 in use** | Change host port in `docker-compose.yml` |
| **n8n won't start** | `docker compose logs n8n` |
| **Browser API not responding** | `docker compose logs browser-api` |
| **Task returns error** | Check `/api/providers` — is your LLM configured? |
| **DeepSeek produces bad results** | Switch to `deepseek-reasoner` or OpenAI/Gemini |
| **Browser session stale** | `curl -X POST http://localhost:7999/api/browser/reset` |
| **Cookies not persisting** | Check `./browser_api/browser_profile/` permissions |

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
├── browser_api/              # Browser API source (for custom builds)
│   ├── server.py             # FastAPI app reference
│   ├── Dockerfile            # Build your own image
│   ├── requirements.txt
│   └── browser_profile/      # Cookie persistence (auto-saved)
└── n8n/
    └── demo-data/            # Drop demo workflow JSON files here
```

## 🙏 Credits

- **[browser-use](https://github.com/browser-use/browser-use)** — core Python library
  that gives AI agents the ability to control a real browser via Playwright. MIT.
- **[browser-use-fastapi-docker-server](https://github.com/gauravdhiman/browser-use-fastapi-docker-server)** —
  reference FastAPI wrapper pattern by gauravdhiman.
- **[browser-use/web-ui](https://github.com/browser-use/web-ui)** — official Gradio
  WebUI whose Agent integration patterns inspired the API design. MIT.

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
