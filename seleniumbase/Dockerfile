# =============================================================================
# SeleniumBase Stealth Browser Service
# Drop-in replacement for Camoufox — same REST API, SeleniumBase CDP stealth
# =============================================================================

FROM python:3.12-slim

# Install system deps for Chromium + SeleniumBase CDP
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-common \
    chromium-sandbox \
    curl \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libu2f-udev \
    libvulkan1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

# Set chromium as default browser for SeleniumBase
ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMIUM_BIN=/usr/bin/chromium

WORKDIR /app

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY app/ ./app/

# Expose REST API port
EXPOSE 9377

# Set environment defaults
ENV SELENIUMBASE_PORT=9377 \
    SELENIUMBASE_API_KEY="" \
    HEADLESS=true \
    VNC_BIND="" \
    DISPLAY=:99

# Entrypoint — start Xvfb then the API server
CMD ["sh", "-c", "Xvfb :99 -screen 0 1920x1080x24 +extension RANDR & \
    exec uvicorn app.main:app --host 0.0.0.0 --port ${SELENIUMBASE_PORT} --log-level info"]
