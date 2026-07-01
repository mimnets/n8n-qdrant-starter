# CutEngine — Design Specification

Self-hosted, Shotstack-compatible video render engine with a hybrid rendering pipeline (Puppeteer + FFmpeg).

## Problem

Beyond Orbit의 270채널 유튜브 자동화 파이프라인에서 Shotstack API 렌더링 비용이 월 $125~$1,900 발생. 채널 수 확장 시 비용이 선형 증가하며, 클라우드 전용이라 셀프호스팅 불가.

## Solution

Shotstack API를 완전 호환하면서 셀프호스팅 가능한 오픈소스 렌더 엔진. 기존 n8n 워크플로우의 Shotstack 노드를 변경 없이 사용할 수 있고, 자체 확장 API로 배치 렌더, 실시간 진행률 등 추가 기능 제공.

## Goals

1. Shotstack Edit/Serve/Ingest/Create API 4개 서비스 풀 스펙 호환
2. 켄번스/트랜지션 품질이 Shotstack과 동등하거나 우월 (CSS 애니메이션 기반)
3. Docker Compose 원클릭 셀프호스팅 배포
4. 270채널 동시 렌더링을 처리할 수 있는 큐 기반 수평 확장
5. 향후 글로벌 SaaS 런칭을 위한 오픈코어 구조

## Target Compatibility

Shotstack API v1 (`https://api.shotstack.io/edit/v1/`) 기준 호환. API 경로, 요청/응답 스키마, 에러 형식 모두 v1 스펙을 따름.

## Non-Goals

- Shotstack의 deprecated 기능(disk 옵션) 구현
- 실시간 영상 스트리밍
- 브라우저 기반 GUI 편집기 (v1 스코프 아님)

---

## Architecture

모듈러 모놀리스 — 하나의 프로세스에서 5개 모듈이 명확한 경계를 갖고 동작. 나중에 모듈 단위로 마이크로서비스 분리 가능.

### Modules

#### 1. API Module (Fastify)

Shotstack 4개 API 서비스를 호환하는 HTTP 엔드포인트.

**Edit API** (`/edit/v1/`)
- `POST /render` — 렌더 작업 제출. Shotstack Edit JSON을 받아 Job Queue에 등록. 202 Accepted + render ID 반환. `callback` URL이 있으면 완료/실패 시 POST 알림 전송.
- `GET /render/:id` — 렌더 상태 폴링. status: queued → fetching → rendering → saving → done/failed. 완료 시 output URL 포함.
- `POST /template` — 템플릿 생성
- `GET /template` — 템플릿 목록
- `GET /template/:id` — 템플릿 조회
- `PUT /template/:id` — 템플릿 수정
- `DELETE /template/:id` — 템플릿 삭제
- `POST /template/:id/render` — 템플릿 기반 렌더 (merge fields 치환)
- `GET /inspect` — 미디어 메타데이터 조회 (ffprobe)

**Serve API** (`/serve/v1/`)
- `GET /assets/:id` — 에셋 조회 (호스팅 URL, 상태)
- `DELETE /assets/:id` — 에셋 삭제
- `GET /assets/render/:id` — 렌더 ID로 에셋 조회
- `POST /assets/transfer` — 외부 전송 (S3, Mux, custom webhook)

**Ingest API** (`/ingest/v1/`)
- `POST /sources` — URL로 소스 fetch
- `GET /sources` — 소스 목록
- `GET /sources/:id` — 소스 상태 조회 (status: queued → importing → ready/failed)
- `DELETE /sources/:id` — 소스 삭제
- `POST /upload` — signed URL 발급 → 직접 업로드

**Create API** (`/create/v1/`)
- `POST /generate` — AI 에셋 생성 (Text-to-Image, Image-to-Video)
- `GET /generate/:id` — 생성 상태 조회

Create API는 **선택적 모듈**. AI 프로바이더 미설정 시 해당 에셋 타입(TextToImageAsset, ImageToVideoAsset)은 501 Not Implemented 반환.

AI 프로바이더 설정 (`config.yaml`):
```yaml
create:
  text_to_image:
    provider: seedream          # seedream | dalle | stability
    api_url: https://api.byteplus.com/...
    api_key: ${SEEDREAM_API_KEY}
    fallback: null              # 실패 시 대체 프로바이더 (optional)
  image_to_video:
    provider: seedance          # seedance | runway | pika
    api_url: https://api.byteplus.com/...
    api_key: ${SEEDANCE_API_KEY}
    model: seedance-1-5-pro-251215
    fallback: null
```

**Extended API** (`/x/v1/`, 자체 확장)
- `POST /render/batch` — 다수 렌더를 한 번에 제출
- `POST /render/preview` — 저해상도 빠른 프리뷰
- `GET /queue/status` — 큐 상태 대시보드
- `WebSocket /ws/render/:id` — 실시간 렌더 진행률

**인증:**
- `x-api-key` 헤더 (Shotstack 호환)
- JWT Bearer token (SaaS 확장용)
- 셀프호스팅 시 API key 없이 사용 가능 (설정으로 토글)

#### 2. Job Queue (BullMQ + Redis)

비동기 렌더 작업 관리.

- **Render Queue** — 렌더 작업. 우선순위 지원 (1-10). Worker 수평 확장.
- **Ingest Queue** — 소스 fetch/업로드 작업
- **Create Queue** — AI 에셋 생성 작업
- **Transfer Queue** — 외부 전송 작업

큐별 동시성 설정: render=CPU 코어 수, ingest=10, create=5, transfer=10.
재시도: 3회, exponential backoff (2s, 4s, 8s).
타임아웃: render=600s, ingest=300s, create=300s, transfer=120s.

#### 3. Render Module

Shotstack JSON을 입력받아 최종 미디어 파일을 출력하는 4단계 파이프라인.

**Stage 1: Timeline Parser**

Shotstack Edit JSON → Internal Representation (IR) 변환.

- JSON Schema 유효성 검사 (ajv)
- Merge field 치환: `{{KEY}}` → value
- `start: "auto"` 해석: 이전 클립 종료 시점으로 계산
- `length: "auto"` 해석: 에셋 원본 길이 사용 (ffprobe로 측정)
- `length: "end"` 해석: 타임라인 끝까지
- `alias://clip-name` 참조 해석
- Track → Layer 변환 (tracks[0]이 최상위 z-index)
- 외부 에셋 URL 수집 → 다운로드 큐 생성

IR 구조:
```
{
  scenes: [{
    startTime: number,
    duration: number,
    layers: [{
      type: 'visual' | 'audio',
      asset: { ... },        // 파싱된 에셋 정보
      timing: { start, duration, transition_in, transition_out },
      effects: { motion, filter, opacity, transform, tween[] },
      position: { fit, scale, offset_x, offset_y },
      crop: { top, bottom, left, right }
    }],
    transition: { type, duration }  // 장면 간 트랜지션
  }],
  audio: {
    soundtrack: { src, effect, volume },
    clips: [{ src, start, duration, volume, volumeEffect, speed }]
  },
  output: { width, height, fps, format, quality, ... },
  assets: [{ url, localPath, type }]  // 다운로드 대기 목록
}
```

**Stage 2: Scene Builder**

IR → HTML/CSS 장면 생성. 각 프레임 시점에 해당하는 HTML 페이지를 생성.

에셋 타입별 HTML 변환:
- `ImageAsset` → `<img>` + CSS object-fit + filter
- `VideoAsset` → `<video>` 태그 (Puppeteer에서 프레임 추출)
- `TextAsset` → `<div>` + CSS font/stroke(text-shadow)/alignment
- `RichTextAsset` → HTML 직접 삽입 + CSS gradient/shadow/animation
- `HtmlAsset` → 사용자 HTML/CSS 직접 삽입
- `ShapeAsset` → CSS shapes 또는 SVG
- `SvgAsset` → 인라인 SVG (12 shape types + fill/stroke/shadow/transform)
- `TitleAsset` → 프리셋 HTML 템플릿
- `LumaAsset` → CSS mask-image
- `CaptionAsset` → 자막 HTML 오버레이 (외부 STT 결과를 alias로 참조, 또는 내장 whisper.cpp 사용)

이펙트 → CSS 매핑:
- Motion effects (zoomIn/Out, slideLeft/Right/Up/Down + Fast/Slow) → CSS `transform: scale() translate()` + `animation` with `ease-in-out`
- Filters (blur, boost, contrast, darken, greyscale, lighten, muted, negative) → CSS `filter` property
- Transitions (fade, reveal, wipe, slide, carousel, shuffle, zoom) → CSS `@keyframes` + opacity/transform
- Tween → CSS `@keyframes` with `cubic-bezier()` easing
- Transform (rotate, skew, flip) → CSS `transform`
- ChromaKey → Canvas API 픽셀 조작 (실시간) 또는 FFmpeg `chromakey` 필터 (후처리)

Viewport 설정:
- Puppeteer 페이지를 output resolution과 동일하게 설정 (예: 1280x720 for HD)
- aspectRatio에 따라 viewport 조정 (9:16이면 1080x1920)

**Stage 3: Frame Capture**

Scene Builder가 생성한 HTML을 Puppeteer로 프레임 단위 캡처.

- Puppeteer 페이지에 HTML 로드
- 프레임 단위 시간 진행: `requestAnimationFrame` 오버라이드 또는 `page.clock` API
- 각 프레임을 PNG로 캡처 → `frames/frame_XXXXX.png`
- FPS: output.fps (기본 25, 최대 60)
- 비디오 클립: FFmpeg로 프레임 추출 후 HTML `<img>`로 삽입 (프레임 동기화)
- 병렬 캡처: 장면 독립적이면 여러 Puppeteer 인스턴스로 병렬 처리

최적화:
- 정적 장면(이미지만, 이펙트 없음)은 단일 프레임 캡처 후 FFmpeg `-loop` 처리
- 트랜지션 구간만 실제 프레임 캡처, 나머지는 스킵

**Stage 4: Encoder (FFmpeg)**

캡처된 프레임 + 오디오 → 최종 미디어 파일.

비디오 인코딩:
```bash
ffmpeg -framerate {fps} -i frames/frame_%05d.png \
  -c:v libx264 -preset medium -crf {quality_crf} \
  -pix_fmt yuv420p -movflags +faststart \
  output.mp4
```

오디오 믹싱:
- 클립별 오디오를 시간축에 맞춰 배치 (amix/amerge)
- Soundtrack: 전체 길이에 걸쳐 배치, volume/effect 적용
- volumeEffect: fadeIn → afade=t=in, fadeOut → afade=t=out, fadeInFadeOut → 둘 다
- 크로스페이드: 인접 BGM 트랙 간 2초 오버랩 시 acrossfade
- Speed: atempo 필터

Output 포맷 매핑:
| format | FFmpeg 명령 |
|--------|-----------|
| mp4 | libx264 + aac |
| gif | palettegen + paletteuse |
| jpg | single frame → mjpeg |
| png | single frame → png |
| bmp | single frame → bmp |
| mp3 | audio only → libmp3lame |

Quality → CRF 매핑:
| quality | CRF |
|---------|-----|
| verylow | 35 |
| low | 28 |
| medium | 23 |
| high | 18 |
| veryhigh | 15 |

#### 4. Template Module

Shotstack 템플릿 시스템 호환.

- 템플릿 CRUD (SQLite/PostgreSQL 저장)
- Merge Fields: `{{PLACEHOLDER}}` → 렌더 시점에 값 치환
- 버전 관리: 템플릿 업데이트 시 이전 버전 보존
- 프리셋 템플릿: 16:9 롱폼, 9:16 쇼츠 7개 포맷

#### 5. Asset Module

렌더링 결과물 및 소스 에셋 관리.

**Storage:**
- 로컬 파일시스템 (셀프호스팅 기본)
- S3 호환 스토리지 (MinIO for 셀프호스팅, AWS S3 for 클라우드)
- 설정으로 전환: `STORAGE_DRIVER=local|s3`

**CDN/Serve:**
- 셀프호스팅: Fastify static file serve (Serve API)
- 클라우드: CloudFront 또는 Cloudflare R2

**Destinations:**
- S3 전송: 렌더 완료 후 지정된 S3 버킷으로 복사
- Mux 전송: Mux API를 통해 비디오 업로드
- Custom Webhook: 완료 알림 + 다운로드 URL 전송

**Media Inspect:**
- ffprobe 래핑: 해상도, 코덱, 길이, 비트레이트 등 메타데이터 반환

---

## Data Flow

```
Client POST /edit/v1/render (Shotstack JSON)
  → API Module: 유효성 검사 → 202 Accepted {id}
  → BullMQ: render 큐에 Job 등록
  → Worker pickup
    → Timeline Parser: JSON → IR
    → Asset Download: 외부 URL → 로컬 캐시
    → Scene Builder: IR → HTML/CSS pages
    → Frame Capture: Puppeteer → PNG sequence
    → Encoder: FFmpeg → MP4/GIF/JPG/...
    → Asset Module: Storage에 저장
  → Job complete: status → done, url 설정
Client GET /edit/v1/render/{id}
  → { status: "done", url: "https://..." }
```

---

## Infrastructure

### Docker Compose

```yaml
services:
  cutengine:    # API + Worker (Fastify + BullMQ)
    image: cutengine:latest
    ports: ["3000:3000"]
    depends_on: [redis, chromium]
    environment:
      - REDIS_URL=redis://redis:6379
      - CHROMIUM_WS=ws://chromium:3000
      - STORAGE_DRIVER=local
      - STORAGE_PATH=/data/assets
    volumes:
      - assets:/data/assets

  redis:          # Job Queue backend
    image: redis:7-alpine
    ports: ["6379:6379"]

  chromium:       # Headless Chromium (Puppeteer 연결)
    image: browserless/chrome:latest
    ports: ["3001:3000"]
    environment:
      - MAX_CONCURRENT_SESSIONS=4

  minio:          # S3 호환 스토리지 (optional)
    image: minio/minio:latest
    ports: ["9000:9000", "9001:9001"]
    command: server /data --console-address ":9001"

  postgres:       # DB (optional, 기본은 SQLite)
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      - POSTGRES_DB=cutengine

volumes:
  assets:
```

셀프호스팅 최소 구성: `cutengine` + `redis` + `chromium` (3개)
풀 구성: 위 5개 전체

### Worker 수평 확장

```bash
docker-compose up --scale cutengine=4 --scale chromium=4
```
각 Worker는 전용 Chromium 인스턴스에 연결. Worker와 Chromium은 1:1로 스케일링.

연결 전략:
- 각 cutengine 인스턴스는 환경변수 또는 서비스 디스커버리로 자신의 Chromium 인스턴스를 찾음
- 대안: 단일 Chromium 인스턴스에 `MAX_CONCURRENT_SESSIONS`을 Worker 수에 맞춰 설정 (예: Worker 4개면 세션 4+)
- 프로덕션: Chromium pool manager가 Worker에 세션을 동적 할당

---

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| HTTP Server | Fastify | Node.js 최고 성능 프레임워크 |
| Job Queue | BullMQ + Redis | 안정적 비동기 큐, 우선순위/재시도/동시성 |
| Browser Engine | Puppeteer + Chromium | CSS 애니메이션 기반 부드러운 이펙트 |
| Video Encoder | FFmpeg | 범용 미디어 인코딩, 모든 포맷 지원 |
| Image Processing | Sharp | Node.js 최고 성능 이미지 라이브러리 |
| JSON Validation | ajv | JSON Schema 유효성 검사 |
| Database | better-sqlite3 / pg | SQLite(셀프호스팅) / PostgreSQL(클라우드) |
| ORM | Drizzle ORM | 타입세이프, 경량, SQLite+PG 모두 지원 |
| Language | TypeScript | 타입 안전성, Shotstack 스키마 타입 정의 |
| Package Manager | pnpm | 빠른 설치, 디스크 효율적 |
| Test | Vitest | 빠른 테스트 러너, ESM 네이티브 |

---

## Shotstack Schema Compatibility

### Asset Types (14종 전체 구현)

| Asset Type | 렌더 방식 | 구현 복잡도 |
|-----------|----------|-----------|
| VideoAsset | FFmpeg 디코딩 + 프레임 추출 | 중 |
| ImageAsset | Sharp 전처리 + HTML/CSS | 하 |
| TextAsset | HTML/CSS 텍스트 렌더링 | 하 |
| RichTextAsset | HTML 직접 삽입 + CSS | 중 |
| AudioAsset | FFmpeg 오디오 믹싱 | 중 |
| ShapeAsset | CSS shapes / SVG | 하 |
| LumaAsset | CSS mask-image | 중 |
| CaptionAsset | HTML 자막 오버레이 (STT는 선택적: alias 참조 또는 내장 whisper.cpp) | 상 |
| HtmlAsset | Puppeteer 직접 렌더 | 하 |
| TitleAsset | 프리셋 HTML 템플릿 | 중 |
| SvgAsset | 인라인 SVG 임베딩 | 중 |
| TextToImageAsset | Create API (Seedream) | 중 |
| ImageToVideoAsset | Create API (Seedance) | 중 |
| Custom (확장) | 플러그인 시스템 | — |

### Effects → CSS Mapping

| Shotstack Effect | CSS 구현 |
|-----------------|---------|
| zoomIn/zoomOut (+Fast/Slow) | `transform: scale()` + `animation` |
| slideLeft/Right/Up/Down | `transform: translate()` + `animation` |
| fade/fadeSlow/fadeFast | `opacity` animation |
| reveal/revealSlow/revealFast | `clip-path` animation |
| wipeLeft/Right/Up/Down | `clip-path: inset()` animation |
| carouselLeft/Right/Up/Down | `transform: translate()` 슬라이드 |
| shuffleLeft/Right | `transform: translate() + rotate()` |
| zoom | `transform: scale()` from center |
| blur | `filter: blur()` |
| boost | `filter: contrast(1.2) saturate(1.3)` |
| greyscale | `filter: grayscale(1)` |
| negative | `filter: invert(1)` |
| darken/lighten | `filter: brightness()` |

### Output Formats

| Resolution | Dimensions | FPS |
|-----------|-----------|-----|
| preview | 512x288 | 15 |
| mobile | 640x360 | 25 |
| sd | 1024x576 | 25 |
| hd | 1280x720 | 25 |
| 1080 | 1920x1080 | 25 |
| 4k | 3840x2160 | 25 |

Aspect Ratios: 16:9 (기본), 9:16, 1:1, 4:5, 4:3
Custom size: `{ width, height }` (2로 나누어 떨어져야 함)
FPS 지원: 12, 15, 24, 23.976, 25, 29.97, 30, 48, 50, 59.94, 60

---

## Differentiation from Shotstack

| | Shotstack | CutEngine |
|---|----------|-------------|
| 배포 | 클라우드 전용 | 셀프호스팅 + 클라우드 |
| 가격 | 렌더당 과금 | 셀프호스팅 무료 |
| 오픈소스 | 폐쇄형 | 코어 오픈소스 |
| 렌더 품질 | 자체 엔진 | CSS 애니메이션 기반 (60fps 부드러운 이징) |
| AI 네이티브 | 제한적 | Seedream/Seedance 네이티브 연동 |
| 유튜브 특화 | 범용 | 배치 렌더, 쇼츠 자동 추출 |
| 확장성 | API 제한 | 플러그인 시스템, 커스텀 에셋 |

---

## Revenue Model (SaaS 런칭 시)

**Free (오픈소스 코어):** 셀프호스팅 무제한, Shotstack API 호환, 기본 이펙트, 커뮤니티 서포트

**Cloud Tier ($29~$199/월):** 매니지드 클라우드, CDN, 자동 스케일링, Shotstack 대비 50-70% 저렴

**Pro Tier ($99~$499/월):** AI 모션 생성, 쇼츠 자동 추출, 배치 렌더 큐, 분석 대시보드

**Enterprise (커스텀):** 전용 클러스터, SLA, 화이트라벨

---

## Project Structure

```
cutengine/
├── src/
│   ├── api/                  # API Module
│   │   ├── edit/             # Edit API routes
│   │   ├── serve/            # Serve API routes
│   │   ├── ingest/           # Ingest API routes
│   │   ├── create/           # Create API routes
│   │   ├── extended/         # Extended API routes
│   │   └── middleware/       # Auth, validation, error handling
│   ├── queue/                # Job Queue Module
│   │   ├── queues.ts         # Queue definitions
│   │   ├── workers/          # Queue workers
│   │   └── events.ts         # Job lifecycle events
│   ├── render/               # Render Module
│   │   ├── parser/           # Timeline Parser (JSON → IR)
│   │   ├── builder/          # Scene Builder (IR → HTML/CSS)
│   │   ├── capture/          # Frame Capture (Puppeteer)
│   │   ├── encoder/          # Encoder (FFmpeg)
│   │   ├── effects/          # Effect implementations
│   │   │   ├── kenburns.ts
│   │   │   ├── transitions.ts
│   │   │   ├── filters.ts
│   │   │   ├── tween.ts
│   │   │   └── chromakey.ts
│   │   └── assets/           # Asset type handlers
│   │       ├── video.ts
│   │       ├── image.ts
│   │       ├── text.ts
│   │       ├── richtext.ts
│   │       ├── audio.ts
│   │       ├── shape.ts
│   │       ├── svg.ts
│   │       ├── html.ts
│   │       ├── luma.ts
│   │       ├── caption.ts
│   │       ├── title.ts
│   │       └── ai.ts         # TextToImage, ImageToVideo
│   ├── template/             # Template Module
│   │   ├── crud.ts
│   │   ├── merge.ts
│   │   └── presets/
│   ├── asset/                # Asset Module
│   │   ├── storage/          # Local FS / S3
│   │   ├── serve.ts          # CDN / static file serve
│   │   ├── destinations/     # S3, Mux, Webhook
│   │   └── inspect.ts        # ffprobe wrapper
│   ├── db/                   # Database
│   │   ├── schema.ts         # Drizzle schema
│   │   └── migrate.ts
│   ├── config/               # Configuration
│   └── index.ts              # Entry point
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── tests/
├── package.json
├── tsconfig.json
└── README.md
```

---

## Observability

**Structured Logging:** pino (Fastify 기본 로거). JSON 포맷, 렌더 ID를 correlation ID로 추적.
- 레벨: error, warn, info, debug
- 각 렌더 단계(parse → build → capture → encode)별 시작/완료/소요시간 로그

**Metrics:** prom-client (Prometheus 호환)
- `cutengine_render_total` — 렌더 요청 수 (status별)
- `cutengine_render_duration_seconds` — 렌더 소요시간 히스토그램
- `cutengine_queue_depth` — 큐 대기 작업 수
- `cutengine_active_workers` — 활성 Worker 수
- `GET /metrics` 엔드포인트 제공

---

## Error Handling

Shotstack 호환 에러 응답 형식:
```json
{
  "success": false,
  "message": "Error description",
  "response": {
    "id": "render-id",
    "status": "failed",
    "error": "Detailed error message"
  }
}
```

렌더 실패 시나리오:
- 에셋 다운로드 실패 → 3회 재시도 후 failed
- Puppeteer 크래시 → Worker 자동 재시작, Job 재시도
- FFmpeg 인코딩 실패 → 로그 수집 후 failed
- 타임아웃 (600s) → failed + 부분 결과 정리

---

## Testing Strategy

- **Unit Tests:** 각 모듈의 핵심 로직 (Timeline Parser, Effect CSS 생성, Output 매핑)
- **Integration Tests:** API 엔드포인트 → 렌더 완료 전체 흐름
- **Compatibility Tests:** Shotstack JSON 샘플을 입력하여 동일한 응답 구조 검증
- **Visual Regression:** 렌더링 결과 스크린샷을 기준 이미지와 비교
- **Beyond Orbit 호환성:** 기존 n8n 워크플로우의 실제 Shotstack 요청을 CutEngine로 전환하여 결과 비교
