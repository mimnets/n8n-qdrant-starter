#!/bin/bash
# BOS Channel E2E Test — CutEngine render with stock images
# Usage: ./run-e2e.sh [cutengine_port] [max_polls]

set -e

PORT=${1:-3002}
MAX_POLLS=${2:-60}
POLL_INTERVAL=5
MIN_FILE_SIZE=10240  # 10KB minimum for valid MP4
BASE="http://localhost:$PORT"

echo "=== BOS E2E Test ==="
echo "CutEngine: $BASE"
echo "Max polls: $MAX_POLLS (timeout: $((MAX_POLLS * POLL_INTERVAL))s)"
echo ""

# Step 1: Health check
echo "[1/4] Health check..."
HEALTH=$(curl -sf "$BASE/health?detail=1") || { echo "ERROR: Health check failed"; exit 1; }
echo "$HEALTH" | python3 -m json.tool 2>/dev/null || echo "$HEALTH"
echo ""

# Step 2: Submit render
echo "[2/4] Submitting render..."
RESPONSE=$(curl -sf -X POST "$BASE/edit/v1/render" \
  -H "Content-Type: application/json" \
  -d @"$(dirname "$0")/bos-render-request.json") || { echo "ERROR: Render submission failed"; exit 1; }
echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

RENDER_ID=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('response',{}).get('id',''))" 2>/dev/null)

if [ -z "$RENDER_ID" ]; then
  echo "ERROR: No render ID returned"
  exit 1
fi
echo "Render ID: $RENDER_ID"
echo ""

# Step 3: Poll for completion
echo "[3/4] Polling for completion..."
URL=""
for i in $(seq 1 "$MAX_POLLS"); do
  STATUS_RESP=$(curl -s "$BASE/edit/v1/render/$RENDER_ID")
  STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('response',{}).get('status',''))" 2>/dev/null)

  if [ "$STATUS" = "done" ]; then
    URL=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('response',{}).get('url',''))" 2>/dev/null)
    echo "DONE! Video URL: $URL"
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "FAILED!"
    echo "$STATUS_RESP" | python3 -m json.tool 2>/dev/null
    exit 1
  else
    printf "  Status: %-10s (attempt %d/%d)\r" "$STATUS" "$i" "$MAX_POLLS"
    sleep "$POLL_INTERVAL"
  fi
done
echo ""

if [ -z "$URL" ]; then
  echo "ERROR: Timed out waiting for render completion"
  exit 1
fi

# Step 4: Download and validate
OUTPUT_DIR="$(dirname "$0")/output"
mkdir -p "$OUTPUT_DIR"
OUTPUT_FILE="$OUTPUT_DIR/bos-e2e-$(date +%Y%m%d%H%M%S).mp4"
echo "[4/4] Downloading to $OUTPUT_FILE..."

# URL may be relative (/serve/...) — prepend base URL
if [[ "$URL" == /* ]]; then
  URL="${BASE}${URL}"
fi
curl -sf -o "$OUTPUT_FILE" "$URL" || { echo "ERROR: Download failed from $URL"; exit 1; }

# Validate file size
FILE_SIZE=$(wc -c < "$OUTPUT_FILE" | tr -d ' ')
if [ "$FILE_SIZE" -lt "$MIN_FILE_SIZE" ]; then
  echo "ERROR: Output file too small (${FILE_SIZE} bytes < ${MIN_FILE_SIZE} bytes minimum)"
  echo "This likely means the download returned an error page, not a video."
  rm -f "$OUTPUT_FILE"
  exit 1
fi

ls -lh "$OUTPUT_FILE"
echo ""
echo "=== E2E SUCCESS ==="
echo "Output: $OUTPUT_FILE (${FILE_SIZE} bytes)"
echo "Play with: open $OUTPUT_FILE"
