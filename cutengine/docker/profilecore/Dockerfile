# ProfileCore — Anti-detect browser automation
# Node.js 20 + Playwright + SQLite
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    sqlite3 \
    && npx playwright install-deps chromium \
    && npx playwright install chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy app (assumes ProfileCore repo is mounted or built separately)
COPY . .

RUN npm install --omit=dev 2>/dev/null || true

EXPOSE 3001

ENV PORT=3001

CMD ["node", "src/index.js"]
