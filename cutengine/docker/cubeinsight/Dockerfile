# CubeInsight — Trend analysis and sentiment API
# Python 3.11 + FastAPI
FROM python:3.11-slim

WORKDIR /app

# Copy app (assumes CubeInsight repo is mounted or built separately)
COPY . .

RUN pip install --no-cache-dir \
    fastapi \
    uvicorn[standard] \
    httpx \
    supabase \
    2>/dev/null || true

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
