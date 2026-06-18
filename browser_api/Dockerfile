# =============================================================================
# browser-api Docker image — single-file server.py wrapping browser-use Agent.
# Based on browser-use-fastapi-docker-server by gauravdhiman:
# https://github.com/gauravdhiman/browser-use-fastapi-docker-server
# =============================================================================

FROM python:3.12-slim

WORKDIR /app

# Shared path so Playwright browsers are accessible by all users
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers

# ---------------------------------------------------------------------------
# System dependencies
# ---------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    wget \
    gnupg \
    ca-certificates \
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
# Playwright Chromium — install to shared location
# ---------------------------------------------------------------------------
RUN mkdir -p /opt/playwright-browsers && chmod 777 /opt/playwright-browsers
RUN playwright install chromium
RUN playwright install-deps chromium

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
COPY server.py /app/
RUN mkdir -p /app/browser_profile && chmod 777 /app/browser_profile

# Drop privileges
RUN adduser --disabled-password --gecos "" appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
