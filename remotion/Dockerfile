FROM node:20-bookworm-slim

# Install Chrome dependencies + ffmpeg for Remotion rendering
RUN apt-get update && apt-get install -y \
    ffmpeg \
    chromium \
    chromium-sandbox \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libexpat1 \
    libxcb1 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --no-frozen-lockfile

COPY . .

# Ensure Chromium is found by Puppeteer/Remotion
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]
