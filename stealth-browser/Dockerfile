# Stealth Browser — Playwright-based anti-detection browser automation
# For LinkedIn, Facebook, and other high-security sites
FROM mcr.microsoft.com/playwright:latest

LABEL org.opencontainers.image.title="Stealth Browser API"
LABEL org.opencontainers.image.description="Anti-detection browser automation with persistent sessions, VNC, and human-like behavior"
LABEL org.opencontainers.image.source="https://github.com/mimnets/n8n-qdrant-starter"

ENV DEBIAN_FRONTEND=noninteractive

# Install Python + VNC + Chrome + utilities all in one layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    xvfb \
    x11vnc \
    fluxbox \
    novnc \
    websockify \
    supervisor \
    wget \
    curl \
    netcat-openbsd \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
RUN pip3 install --no-cache-dir \
    playwright>=1.50.0 \
    fastapi>=0.115.0 \
    uvicorn[standard]>=0.32.0 \
    Pillow>=10.0.0 \
    python-multipart>=0.0.9

# Install Google Chrome (real Chrome, not Chromium — better fingerprint)
# Playwright image already has Chromium, but let's add real Chrome for authenticity
RUN wget -q -O /tmp/chrome.deb \
    "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb" \
    && dpkg -i /tmp/chrome.deb || apt-get install -fy \
    && rm /tmp/chrome.deb

# Ensure Playwright browsers
RUN npx playwright install chromium 2>/dev/null || true && \
    npx playwright install-deps chromium 2>/dev/null || true

WORKDIR /app

# Copy application code
COPY src/ /app/stealth_browser/src/
COPY requirements.txt /app/requirements.txt
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Create directories for persistent data
RUN mkdir -p /app/profiles /app/cookies /app/uploads \
    && chmod -R 777 /app/profiles /app/cookies /app/uploads

ENV DISPLAY=:99
ENV RESOLUTION=1920x1080x24
ENV API_PORT=8001
ENV PROFILE_DIR=/app/profiles
ENV COOKIE_DIR=/app/cookies
ENV HEADLESS=false
ENV LOG_LEVEL=INFO

EXPOSE 8001 6080 5900

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
    CMD curl -f http://localhost:${API_PORT}/health || exit 1

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
