# n8n + Qdrant AI Stack 🚀

[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> Production-ready AI automation stack with n8n and Qdrant vector database.

## 📖 Overview

A lightweight, self-hosted AI automation stack combining **[n8n](https://n8n.io)** workflow automation with **[Qdrant](https://qdrant.tech)** vector database. Use external AI providers (OpenAI, Anthropic, Cohere) for AI capabilities.

Perfect for: OCI free tier, budget VPS, and homelab servers.

## 🏗️ Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│             │     │              │     │             │
│  PostgreSQL │◄────│     n8n      │────►│   Qdrant    │
│  (metadata) │     │ (automation) │     │  (vectors)  │
│             │     │              │     │             │
└─────────────┘     └──────────────┘     └─────────────┘
      :5432               :5678               :6333
```

- **PostgreSQL 16** — n8n workflow metadata, credentials, execution history
- **n8n** — workflow automation engine with 400+ integrations
- **Qdrant** — vector database for semantic search, RAG, and AI memory

## ⚠️ Important

**The default `.env` values are placeholders.** If you don't replace them before starting the stack, n8n will fail to run — the encryption key and JWT secret must be properly generated 64-character hex strings. Run `./scripts/setup.sh` to generate secure values automatically, or manually generate them:

```bash
openssl rand -hex 32  # for N8N_ENCRYPTION_KEY and N8N_USER_MANAGEMENT_JWT_SECRET
```

Also replace `POSTGRES_PASSWORD` with a strong password of your own.

## 🚀 Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/mimnets/n8n-qdrant-starter.git
cd n8n-qdrant-starter

# 2. Run setup (creates .env with secure keys + required directories)
./scripts/setup.sh

# 3. Edit .env and verify all values are set (encryption key, JWT secret, DB password)
nano .env

# 4. Start the stack
docker compose up -d
```

Access n8n at **[http://localhost:5678](http://localhost:5678)** and Qdrant at **[http://localhost:6333](http://localhost:6333)**.

## 📋 Requirements

| Requirement | Minimum |
|------------|---------|
| Docker | 20.10+ |
| Docker Compose | v2+ |
| RAM | 4 GB |
| Disk | 10 GB free |

## 🗄️ Services

| Service | Image | Port | Description |
|---------|-------|------|-------------|
| `postgres` | `postgres:16-alpine` | `5432` (internal) | n8n metadata & workflow storage |
| `n8n` | `n8nio/n8n:latest` | `5678` | Workflow automation engine |
| `qdrant` | `qdrant/qdrant:latest` | `6333` | Vector database for AI embeddings |

## 🔗 Using Qdrant in n8n

Qdrant is on the internal `demo` network. From n8n workflows, connect via:

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

For advanced Qdrant operations (create collections, upsert vectors, search), use the **HTTP Request node** in n8n with the Qdrant REST API.

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
- Never commit `.env` to version control (it's in `.gitignore`)

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Port 5678 already in use** | Change port mapping in `docker-compose.yml`: `"5679:5678"` |
| **n8n won't start** | Check logs: `docker compose logs n8n` |
| **Database connection refused** | Ensure PostgreSQL is healthy: `docker compose ps postgres` |
| **Permission denied on scripts** | Run `chmod +x scripts/*.sh` |
| **password authentication failed for user "n8n"** | Stale Postgres volume with an old password. Wipe and restart: `docker compose down -v && docker compose up -d` |
| **Demo data not imported** | Remove volume and restart: `docker compose down -v && docker compose up -d` |

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
└── n8n/
    └── demo-data/        # Drop demo workflow JSON files here
        └── .gitkeep
```

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

**Just n8n + Qdrant + your cloud AI provider of choice.**
