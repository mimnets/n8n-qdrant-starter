# browser-api — REST Bridge for n8n ↔ Browser Use

Self-contained REST API that wraps the official [`browser-use`](https://github.com/browser-use/browser-use) Agent library, designed to be called from n8n HTTP Request nodes.

## Inspiration

The architecture and Agent integration patterns are based on the official
[**browser-use/web-ui**](https://github.com/browser-use/web-ui) project — we use the same underlying
`browser_use.Agent` and `browser_use.Browser` APIs, exposed through a programmatic
FastAPI REST interface instead of a Gradio frontend.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/ping` | Health check |
| `POST` | `/api/v1/run-task` | Start a browser task |
| `GET` | `/api/v1/task/{id}` | Full task details |
| `GET` | `/api/v1/task/{id}/status` | Status + result |
| `PUT` | `/api/v1/stop-task/{id}` | Stop a task |
| `PUT` | `/api/v1/pause-task/{id}` | Pause a task |
| `PUT` | `/api/v1/resume-task/{id}` | Resume a task |
| `GET` | `/api/v1/list-tasks` | List all tasks |
| `GET` | `/api/v1/browser-config` | Current browser config |
| `GET` | `/live/{id}` | Embeddable live view (HTML) |

## Usage from n8n

```
POST http://browser-api:8000/api/v1/run-task
Content-Type: application/json

{
  "task": "Go to example.com and extract the page title",
  "ai_provider": "openai",
  "max_steps": 50
}
```

## Supported LLM Providers

`openai`, `deepseek`, `anthropic`, `google`, `mistral`, `ollama`, `azure`

Configured via environment variables in the parent `.env` file.

## License

MIT — same as the browser-use/web-ui project that inspired this design.
