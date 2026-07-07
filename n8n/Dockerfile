# Stage 1: Get ffmpeg from Alpine's package repo
FROM alpine:3.24 AS ffmpeg-builder
RUN apk add --no-cache ffmpeg

# Stage 2: n8n with ffmpeg
FROM n8nio/n8n:latest

USER root

# Copy ffmpeg, ffprobe, and all their libraries
COPY --from=ffmpeg-builder /usr/bin/ffmpeg /usr/bin/ffprobe /usr/local/bin/
COPY --from=ffmpeg-builder /usr/lib/ /usr/lib/

# Verify it works
RUN ffmpeg -version | head -1 && ffprobe -version | head -1

USER node
