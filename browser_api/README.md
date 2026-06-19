# browser-api — Persistent Browser REST API for n8n

Single-file FastAPI server wrapping `browser-use==0.1.48` with a persistent browser
and cookie persistence — login sessions survive between calls and across restarts.

Design based on [browser-use-fastapi-docker-server](https://github.com/gauravdhiman/browser-use-fastapi-docker-server).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check → `{"status":"ok"}` |
| `POST` | `/api/run` | Run a browser task (blocks, returns result) |
| `POST` | `/api/browser/reset` | Reset browser + clear cookies |
| `GET` | `/api/providers` | List configured LLM providers |

## POST /api/run

```json
{
  "task": "Go to linkedin.com and check notifications",
  "llm_provider": "deepseek",
  "model_name": null,
  "max_steps": 30,
  "use_vision": false,
  "sensitive_data": {"email": "you@example.com", "password": "s3cret"}
}
```

Response:
```json
{
  "success": true,
  "result": "You have 3 new notifications...",
  "error": null,
  "steps_taken": 12
}
```

Use `{{variable}}` syntax in task strings — e.g. `"Log in with {{email}} and {{password}}"`.

## Cookie persistence

- Cookies saved to `./browser_profile/cookies.json` after each task
- Automatically reloaded on container restart
- `POST /api/browser/reset` clears cookies + starts fresh browser

## LLM Providers

Set in `.env`: `DEEPSEEK_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.

Check `/api/providers` to see which are configured.
