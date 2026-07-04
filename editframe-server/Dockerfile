FROM node:20-bookworm-slim

# Install Chromium (full) + FFmpeg
# The Debian chromium package on ARM64 includes WebCodecs support
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --no-frozen-lockfile

# Install Playwright Chromium for any playwright-based tools
RUN npx playwright install chromium

# Symlink system Chromium -> where Editframe CLI & Playwright expect it
RUN ln -sf /usr/bin/chromium /opt/google/chrome/chrome 2>/dev/null || true
ENV CHROME_PATH=/usr/bin/chromium

COPY . .

EXPOSE 3000

ENTRYPOINT ["npx", "tsx", "src/server.ts"]
