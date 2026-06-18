"""
Image Upload API Server

A lightweight self-hosted replacement for imgbb/imgur.
Stores uploaded images to disk and serves them back.
Intended for n8n workflow HTTP Request nodes.

Endpoints
---------
GET  /health              — health check
POST /upload              — upload an image (multipart/form-data)
GET  /images/{filename}   — serve an uploaded image
DELETE /images/{filename} — delete an image (requires API key)
GET  /images              — list all uploaded images (requires API key)
"""

import os
import uuid
import time
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Header, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import uvicorn

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

API_KEY = os.getenv("UPLOAD_API_KEY", "").strip()
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "10"))
MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

# Base URL used when building public image URLs in upload responses.
# Set this to the external URL if n8n needs a public link, e.g.
#   BASE_URL=https://images.yourdomain.com
# When empty, the URL is built from the request's Host header.
BASE_URL = os.getenv("BASE_URL", "").strip()

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "tif"}

# MIME type map for serving static files with correct Content-Type
MIME_MAP = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "bmp": "image/bmp",
    "svg": "image/svg+xml",
    "ico": "image/x-icon",
    "tiff": "image/tiff",
    "tif": "image/tiff",
}

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Image Upload API",
    description="Self-hosted image upload service — drop-in imgbb replacement for n8n workflows.",
    version="1.0.0",
)


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def check_api_key(
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
) -> bool:
    """Validate API key from header or query param. No-op if no key is configured."""
    if not API_KEY:
        return True
    key = x_api_key or api_key
    if key != API_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")
    return True


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    """Health check endpoint."""
    files = list(UPLOAD_DIR.iterdir())
    return {
        "status": "ok",
        "uploads_dir": str(UPLOAD_DIR),
        "stored_files": len(files),
        "api_key_configured": bool(API_KEY),
    }


@app.post("/upload")
async def upload_image(
    request: Request,
    file: UploadFile = File(...),
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
):
    """
    Upload an image.

    Send as multipart/form-data with the file in a field named `file`.

    n8n HTTP Request node example:
      Method: POST
      URL: http://image-upload:8001/upload?api_key=YOUR_KEY
      Body Type: Form-Data
      Fields: file (mode: "From Binary Property")

    Returns JSON with the public URL you can use in downstream nodes.
    """
    check_api_key(x_api_key, api_key)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Validate extension
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '.{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Generate a unique, sortable filename: YYYYMMDD_HHMMSS_uuid.ext
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    unique_name = f"{timestamp}_{uuid.uuid4().hex[:8]}.{ext}"
    file_path = UPLOAD_DIR / unique_name

    # Read and validate size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content)} bytes). Max allowed: {MAX_FILE_SIZE_MB} MB",
        )

    # Write to disk
    file_path.write_bytes(content)

    # Build public URL
    if BASE_URL:
        base = BASE_URL.rstrip("/")
    else:
        # Fall back to request Host header so the URL just works
        host = request.headers.get("host", "localhost:8001")
        scheme = "https" if request.headers.get("x-forwarded-proto") == "https" else "http"
        base = f"{scheme}://{host}"

    url = f"{base}/images/{unique_name}"

    return {
        "success": True,
        "filename": unique_name,
        "url": url,
        "size_bytes": len(content),
        "content_type": MIME_MAP.get(ext, "application/octet-stream"),
    }


@app.delete("/images/{filename}")
async def delete_image(
    filename: str,
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
):
    """Delete an uploaded image. Requires API key."""
    check_api_key(x_api_key, api_key)

    file_path = UPLOAD_DIR / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="Image not found")

    # Safety: ensure the resolved path is inside UPLOAD_DIR
    if UPLOAD_DIR not in file_path.resolve().parents and file_path.resolve() != UPLOAD_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path.unlink()
    return {"success": True, "filename": filename, "deleted": True}


@app.get("/images")
async def list_images(
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
):
    """List all uploaded images. Requires API key."""
    check_api_key(x_api_key, api_key)

    files = []
    for f in sorted(UPLOAD_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.is_file():
            files.append({
                "filename": f.name,
                "size_bytes": f.stat().st_size,
                "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(f.stat().st_mtime)),
            })

    return {"count": len(files), "images": files}


# ---------------------------------------------------------------------------
# Static file serving — must be mounted LAST so routes match first
# ---------------------------------------------------------------------------

app.mount("/images", StaticFiles(directory=str(UPLOAD_DIR)), name="images_static")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
