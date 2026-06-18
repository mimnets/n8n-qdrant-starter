# =============================================================================
# browser-api Docker image
#
# Based on patterns from the official browser-use/web-ui Dockerfile:
# https://github.com/browser-use/web-ui
# =============================================================================

FROM python:3.11-slim

WORKDIR /app

# ---------------------------------------------------------------------------
# System dependencies (Playwright + healthcheck)
# ---------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    gnupg \
    ca-certificates \
    # Playwright browser runtime deps
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Python dependencies
# ---------------------------------------------------------------------------
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---------------------------------------------------------------------------
# Playwright browsers — MUST run as root so the binaries are system-wide
# ---------------------------------------------------------------------------
RUN playwright install chromium
RUN playwright install-deps chromium

# ---------------------------------------------------------------------------
# Application code — copy into a subdirectory so the Python package works
# ---------------------------------------------------------------------------
COPY . /app/browser_api/
RUN mkdir -p /app/data && chmod 777 /app/data

# ---------------------------------------------------------------------------
# Drop privileges
# ---------------------------------------------------------------------------
RUN adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/v1/ping || exit 1

CMD ["python", "-m", "browser_api.app"]
