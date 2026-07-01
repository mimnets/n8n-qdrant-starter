# Health Check Endpoint Design

## Overview

Add `GET /health` endpoint that serves as both Docker liveness probe and detailed monitoring endpoint.

## Endpoint

```
GET /health          → liveness (fast, no dependency checks)
GET /health?detail=1 → readiness (all dependency checks)
```

## Response Schema

### Basic (liveness)
```json
{ "status": "ok", "uptime": 3600, "version": "0.4.0" }
```

### Detailed (readiness)
```json
{
  "status": "ok | degraded | error",
  "uptime": 3600,
  "version": "0.4.0",
  "checks": {
    "redis": { "status": "ok", "latency": 2 },
    "chromium": { "status": "ok", "latency": 45 },
    "ffmpeg": { "status": "ok", "version": "6.1" },
    "disk": { "status": "ok", "free_gb": 42.5, "path": "/data/assets" },
    "gpu": { "status": "disabled" }
  }
}
```

## Checks

| Check | Method | Timeout | Critical |
|-------|--------|---------|----------|
| Redis | ioredis `ping()` | 3s | Yes |
| Chromium | WebSocket connect to `wsEndpoint` | 5s | No |
| FFmpeg | `ffmpeg -version` spawn | 3s | Yes |
| Disk | `statvfs` free space | instant | No |
| GPU | GPUMemoryManager status (if enabled) | 3s | No |

## Status Logic

- `ok` — all checks pass
- `degraded` — non-critical check failed (Chromium, disk, GPU)
- `error` — critical check failed (Redis or FFmpeg)

## HTTP Status Codes

- `200` — ok or degraded
- `503` — error

## Files

- `src/api/health.ts` — route + check logic
- `tests/api/health.test.ts` — unit tests
