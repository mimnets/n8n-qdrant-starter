"""
File Upload API Server

A lightweight self-hosted file hosting service (replacement for imgbb/imgur etc.).
Stores uploaded files (images, audio, documents, and more) to disk and serves
them back. Intended for n8n workflow HTTP Request nodes.

Migrated from "Image Upload" → "File Upload" to support audio and other file types.
Key change: ALLOWED_EXTENSIONS now includes common audio/document/archive types.

Endpoints
---------
GET  /health              — health check
POST /upload              — upload a file (multipart/form-data with field `file`)
GET  /files/{filename}    — serve an uploaded file
DELETE /files/{filename}  — delete a file (requires API key)
GET  /files               — list all uploaded files (requires API key)
GET  /admin               — browser-based management GUI (requires API key)
"""

import os
import uuid
import time
from pathlib import Path

from fastapi import FastAPI, File, UploadFile, HTTPException, Header, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
import uvicorn

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "/app/uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

API_KEY = os.getenv("UPLOAD_API_KEY", "").strip()
MAX_FILE_SIZE_MB = int(os.getenv("MAX_FILE_SIZE_MB", "50"))
MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

# Base URL used when building public file URLs in upload responses.
# Set this to the external URL if n8n needs a public link, e.g.
#   BASE_URL=https://files.yourdomain.com
# When empty, the URL is built from the request's Host header.
BASE_URL = os.getenv("BASE_URL", "").strip()

# Allowed file extensions — expanded to support audio, documents, and archives.
# This is the list checked when extracting extension from the filename.
ALLOWED_EXTENSIONS = {
    # Images (original)
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tiff", "tif",
    # Audio
    "mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus",
    # Documents
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "json", "xml", "md",
    # Archives
    "zip", "tar", "gz", "bz2", "7z", "rar",
    # Video
    "mp4", "mov", "avi", "mkv", "webm",
}

# MIME type map for serving files with correct Content-Type header
MIME_MAP = {
    # Images
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
    # Audio
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
    "flac": "audio/flac",
    "aac": "audio/aac",
    "m4a": "audio/mp4",
    "wma": "audio/x-ms-wma",
    "opus": "audio/opus",
    # Documents
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "csv": "text/csv",
    "json": "application/json",
    "xml": "application/xml",
    "md": "text/markdown",
    # Archives
    "zip": "application/zip",
    "tar": "application/x-tar",
    "gz": "application/gzip",
    "bz2": "application/x-bzip2",
    "7z": "application/x-7z-compressed",
    "rar": "application/vnd.rar",
    # Video
    "mp4": "video/mp4",
    "mov": "video/quicktime",
    "avi": "video/x-msvideo",
    "mkv": "video/x-matroska",
    "webm": "video/webm",
}

# Magic-byte signatures for file type detection.
# Used when the filename extension is missing or garbage (e.g. n8n derives a
# filename from an API endpoint like "FLUX.1-schnell").
SIGNATURES: list[tuple[bytes, str]] = [
    # Images (original)
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    (b"GIF8", "gif"),
    (b"RIFF", "webp"),  # RIFF....WEBP — checked in detect_extension
    (b"BM", "bmp"),
    (b"\x00\x00\x01\x00", "ico"),
    (b"II*\x00", "tiff"),
    (b"MM\x00*", "tiff"),
    (b"<?xml", "svg"),
    (b"<svg", "svg"),
    (b"<SVG", "svg"),
    # Audio
    (b"ID3", "mp3"),           # ID3v2 tag (most MP3 files)
    (b"\xff\xfb", "mp3"),      # MPEG 1 Layer 3 without sync
    (b"\xff\xf3", "mp3"),      # MPEG 1 Layer 3
    (b"\xff\xe3", "mp3"),      # MPEG 1 Layer 3
    (b"RIFF", "wav"),          # RIFF....WAVE — checked in detect_extension
    (b"OggS", "ogg"),
    (b"fLaC", "flac"),
    # Documents
    (b"%PDF", "pdf"),
    (b"PK\x03\x04", "zip"),    # Also matches docx/xlsx/pptx (Office Open XML)
    (b"PK\x05\x06", "zip"),    # Empty ZIP archive
    (b"PK\x07\x08", "zip"),    # Spanned ZIP archive
    (b"Rar!\x1a\x07", "rar"),
    (b"BZh", "bz2"),
    (b"\x1f\x8b", "gz"),       # gzip
    (b"7573\x74\x61\x72", "tar"), # "ustar" at offset 257, handled in detect_extension
]


def detect_extension(content: bytes) -> str | None:
    """Detect file extension from magic bytes. Returns None if unknown."""
    if len(content) < 12:
        return None
    for magic, ext in SIGNATURES:
        if content.startswith(magic):
            # RIFF container: verify subtype
            if ext == "webp" and content[8:12] != b"WEBP":
                continue
            if ext == "wav" and content[8:12] != b"WAVE":
                continue
            return ext
    # Check for ustar (tar) at offset 257
    if len(content) >= 262 and content[257:262] == b"ustar":
        return "tar"
    return None


# ---------------------------------------------------------------------------
# Admin panel HTML (served at /admin)
# ---------------------------------------------------------------------------

ADMIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>File Upload — Admin</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;color:#1e293b;min-height:100vh}
  header{background:#0f172a;color:#e2e8f0;padding:16px 24px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
  header h1{font-size:1.25rem;font-weight:600;display:flex;align-items:center;gap:8px}
  header h1 span{font-size:1.4rem}
  .stats{display:flex;flex-wrap:wrap;gap:16px;font-size:.85rem}
  .stat{background:#1e293b;padding:6px 14px;border-radius:8px;white-space:nowrap}
  .stat strong{color:#93c5fd}
  .key-section{background:#fff;padding:12px 24px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap}
  .key-section label{font-weight:600;font-size:.9rem;white-space:nowrap}
  .key-section input{flex:1;min-width:200px;padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:.9rem;font-family:monospace}
  .key-section button{padding:6px 18px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:.85rem}
  .key-section button:hover{background:#2563eb}
  .key-section .no-key-badge{background:#dcfce7;color:#166534;padding:4px 10px;border-radius:6px;font-size:.8rem;font-weight:600}
  .container{padding:20px 24px}
  .toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;margin-bottom:20px}
  .toolbar .info{font-size:.9rem;color:#64748b}
  .toast{position:fixed;top:16px;right:16px;z-index:9999;padding:12px 20px;border-radius:8px;color:#fff;font-weight:500;font-size:.9rem;animation:slideIn .25s ease;box-shadow:0 4px 12px rgba(0,0,0,.15);display:none}
  .toast.success{background:#16a34a}
  .toast.error{background:#dc2626}
  @keyframes slideIn{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px}
  .card{background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:box-shadow .2s,transform .15s;display:flex;flex-direction:column}
  .card:hover{box-shadow:0 4px 16px rgba(0,0,0,.12);transform:translateY(-2px)}
  .card .thumb{width:100%;height:160px;object-fit:cover;background:#e2e8f0;cursor:pointer;display:block}
  .card .thumb.placeholder{display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:2.5rem}
  .card .body{padding:10px 12px;flex:1;display:flex;flex-direction:column;gap:4px}
  .card .fname{font-size:.8rem;font-weight:600;word-break:break-all;color:#334155;line-height:1.2}
  .card .meta{font-size:.75rem;color:#94a3b8;display:flex;justify-content:space-between}
  .card .actions{padding:0 12px 10px}
  .card .actions button{width:100%;padding:6px 0;border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;cursor:pointer;font-weight:600;font-size:.82rem;transition:background .15s}
  .card .actions button:hover{background:#fee2e2}
  .card audio{margin:4px 0;width:100%}
  .empty{text-align:center;padding:60px 20px;color:#94a3b8}
  .empty .icon{font-size:3rem;display:block;margin-bottom:12px}
  .empty p{font-size:1rem;margin-bottom:4px}
  .empty small{font-size:.85rem}
  .loading{text-align:center;padding:40px;color:#64748b}
  .spinner{width:32px;height:32px;border:3px solid #e2e8f0;border-top-color:#3b82f6;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 12px}
  @keyframes spin{to{transform:rotate(360deg)}}
  .modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.5);z-index:9000;display:flex;align-items:center;justify-content:center;animation:fadeIn .15s}
  .modal{background:#fff;border-radius:12px;padding:24px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.2)}
  .modal h3{margin-bottom:8px;font-size:1.1rem}
  .modal p{margin-bottom:20px;color:#64748b;font-size:.9rem;word-break:break-all}
  .modal .btns{display:flex;gap:10px;justify-content:flex-end}
  .modal .btns button{padding:8px 20px;border-radius:6px;border:none;cursor:pointer;font-weight:600;font-size:.85rem}
  .modal .cancel{background:#e2e8f0;color:#334155}
  .modal .cancel:hover{background:#cbd5e1}
  .modal .confirm{background:#dc2626;color:#fff}
  .modal .confirm:hover{background:#b91c1c}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  @media(max-width:600px){header{flex-direction:column;align-items:flex-start}.stats{gap:8px}.grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}.card .thumb{height:130px}}
</style>
</head>
<body>

<header>
  <h1><span>&#x1f4c1;</span> File Upload Admin</h1>
  <div class="stats" id="stats"></div>
</header>

<div class="key-section" id="keySection" style="display:none">
  <label for="apiKeyInput">&#x1f511; API Key:</label>
  <input type="password" id="apiKeyInput" placeholder="Enter your UPLOAD_API_KEY">
  <button onclick="connect()">Connect</button>
</div>

<div id="toast" class="toast"></div>
<div id="modalZone"></div>

<div class="container">
  <div class="toolbar">
    <span class="info" id="toolbarInfo"></span>
    <button onclick="refresh()" style="padding:6px 16px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;font-size:.85rem;font-weight:500">&#x21bb; Refresh</button>
  </div>
  <div id="content"></div>
</div>

<script>
const state = { apiKey: '', files: [], totalBytes: 0, keyConfigured: false };

async function init() {
  const params = new URLSearchParams(location.search);
  const urlKey = params.get('api_key');
  if (urlKey) {
    state.apiKey = urlKey;
    history.replaceState(null, '', location.pathname);
  }
  try {
    const r = await fetch('/health');
    const h = await r.json();
    state.keyConfigured = h.api_key_configured;
    updateStats(h.stored_files, 0);
  } catch(e) {
    updateStats(0, 0);
  }
  if (state.keyConfigured && !state.apiKey) {
    document.getElementById('keySection').style.display = 'flex';
    document.getElementById('content').innerHTML = '<div class="empty"><span class="icon">&#x1f511;</span><p>API key required</p><small>Enter your UPLOAD_API_KEY above and click Connect</small></div>';
  } else if (state.keyConfigured && state.apiKey) {
    document.getElementById('keySection').style.display = 'flex';
    document.getElementById('apiKeyInput').value = state.apiKey;
    await loadFiles();
  } else {
    document.getElementById('keySection').style.display = 'none';
    await loadFiles();
  }
}

async function connect() {
  state.apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!state.apiKey) return;
  await loadFiles();
}

const AUDIO_EXTS = ['mp3','wav','ogg','flac','aac','m4a','wma','opus'];

async function loadFiles() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading"><div class="spinner"></div>Loading files\u2026</div>';
  const qs = state.apiKey ? '?api_key=' + encodeURIComponent(state.apiKey) : '';
  try {
    const r = await fetch('/files' + qs);
    if (!r.ok) {
      if (r.status === 403) {
        content.innerHTML = '<div class="empty"><span class="icon">&#x1f6ab;</span><p>Invalid API key</p><small>Check your key and try again</small></div>';
        document.getElementById('keySection').style.display = 'flex';
        return;
      }
      throw new Error('HTTP ' + r.status);
    }
    const data = await r.json();
    state.files = data.files || [];
    state.totalBytes = state.files.reduce((s, i) => s + i.size_bytes, 0);
    updateStats(state.files.length, state.totalBytes);
    document.getElementById('toolbarInfo').textContent = state.files.length + ' file' + (state.files.length !== 1 ? 's' : '') + ' \u00b7 ' + formatBytes(state.totalBytes);
    renderGrid();
  } catch(e) {
    content.innerHTML = '<div class="empty"><span class="icon">&#x26a0;</span><p>Failed to load files</p><small>' + esc(e.message) + '</small></div>';
  }
}

const VIDEO_EXTS = ['mp4','mov','avi','mkv','webm'];
const IMG_EXTS = ['png','jpg','jpeg','gif','webp','bmp','svg','ico','tiff','tif'];

function renderGrid() {
  const el = document.getElementById('content');
  if (state.files.length === 0) {
    el.innerHTML = '<div class="empty"><span class="icon">&#x1f4c2;</span><p>No files yet</p><small>Uploaded files will appear here</small></div>';
    return;
  }
  let html = '<div class="grid">';
  for (const f of state.files) {
    const url = '/files/' + encodeURIComponent(f.filename);
    const parts = f.filename.split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
    const isImage = IMG_EXTS.includes(ext);
    const isAudio = AUDIO_EXTS.includes(ext);
    const isVideo = VIDEO_EXTS.includes(ext);

    let mediaHtml;
    if (isImage) {
      mediaHtml = `<img class="thumb" src="${url}" alt="${esc(f.filename)}" loading="lazy">`;
    } else if (isAudio) {
      mediaHtml = `<audio controls preload="none" style="width:100%;height:50px;margin:6px 0"><source src="${url}"></audio>`;
    } else if (isVideo) {
      mediaHtml = `<video controls preload="none" style="width:100%;height:150px;background:#000;border-radius:6px"><source src="${url}"></video>`;
    } else {
      mediaHtml = '<div class="thumb placeholder">&#x1f4c4;</div>';
    }

    const fname = esc(f.filename);
    html += `<div class="card" id="card-${CSS.escape(f.filename)}">`;
    html += `<a href="${url}" target="_blank">${mediaHtml}</a>`;
    html += `<div class="body">`;
    html += `<span class="fname" title="${fname}">${fname}</span>`;
    html += `<span class="meta"><span>${formatBytes(f.size_bytes)}</span><span>${f.modified}</span></span>`;
    html += `</div>`;
    html += `<div class="actions"><button onclick="confirmDelete('${escAttr(f.filename)}')">&#x1f5d1; Delete</button></div>`;
    html += `</div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function confirmDelete(filename) {
  const zone = document.getElementById('modalZone');
  zone.innerHTML = [
    `<div class="modal-overlay" onclick="if(event.target===this)closeModal()">`,
    `<div class="modal">`,
    `<h3>Delete file?</h3>`,
    `<p>${esc(filename)}</p>`,
    `<div class="btns">`,
    `<button class="cancel" onclick="closeModal()">Cancel</button>`,
    `<button class="confirm" onclick="doDelete('${escAttr(filename)}')">Delete</button>`,
    `</div>`,
    `</div>`,
    `</div>`
  ].join('');
}

function closeModal() {
  document.getElementById('modalZone').innerHTML = '';
}

async function doDelete(filename) {
  closeModal();
  const qs = state.apiKey ? '?api_key=' + encodeURIComponent(state.apiKey) : '';
  try {
    const r = await fetch('/files/' + encodeURIComponent(filename) + qs, { method: 'DELETE' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const card = document.getElementById('card-' + CSS.escape(filename));
    if (card) {
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      card.style.transition = 'opacity .2s, transform .2s';
      setTimeout(() => card.remove(), 200);
    }
    state.files = state.files.filter(i => i.filename !== filename);
    state.totalBytes = state.files.reduce((s, i) => s + i.size_bytes, 0);
    updateStats(state.files.length, state.totalBytes);
    document.getElementById('toolbarInfo').textContent = state.files.length + ' file' + (state.files.length !== 1 ? 's' : '') + ' \u00b7 ' + formatBytes(state.totalBytes);
    if (state.files.length === 0) renderGrid();
    showToast('Deleted', 'success');
  } catch(e) {
    showToast('Failed to delete: ' + e.message, 'error');
  }
}

function refresh() { loadFiles(); }

function updateStats(count, bytes) {
  document.getElementById('stats').innerHTML =
    '<div class="stat"><strong>' + count + '</strong> file' + (count !== 1 ? 's' : '') + '</div>' +
    '<div class="stat"><strong>' + formatBytes(bytes) + '</strong> total</div>' +
    '<div class="stat">' + (state.keyConfigured ? '&#x1f512; Auth on' : '&#x1f513; Open') + '</div>';
}

function formatBytes(b) {
  if (b >= 1073741824) return (b/1073741824).toFixed(1) + ' GB';
  if (b >= 1048576) return (b/1048576).toFixed(1) + ' MB';
  if (b >= 1024) return (b/1024).toFixed(1) + ' KB';
  return b + ' B';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast ' + type;
  t.style.display = 'block';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.style.display = 'none', 2500);
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
document.getElementById('apiKeyInput').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });

init();
</script>
</body>
</html>"""



# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="File Upload API",
    description="Self-hosted file upload service — images, audio, documents, and more. "
                "Drop-in imgbb replacement for n8n workflows.",
    version="2.0.0",
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
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
):
    """
    Upload a file.

    Send as multipart/form-data with the file in a field named `file`.

    n8n HTTP Request node:
      Method: POST
      URL: http://file-upload:8001/upload?api_key=YOUR_KEY
      Body Type: Form-Data
      Fields: file (mode: "From Binary Property")

    Returns JSON with the public URL you can use in downstream nodes.
    """
    check_api_key(x_api_key, api_key)

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Read content first — we need it for both size check and type detection
    content = await file.read()

    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({len(content)} bytes). Max allowed: {MAX_FILE_SIZE_MB} MB",
        )

    # Determine extension.
    # Try the filename extension first, but when it's garbage (e.g. n8n derives
    # the filename from an HF API endpoint like "FLUX.1-schnell"), fall back to
    # magic-byte detection on the actual binary content.
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        detected = detect_extension(content)
        if detected:
            ext = detected
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type '.{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
            )

    # Generate a unique, sortable filename: YYYYMMDD_HHMMSS_uuid.ext
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    unique_name = f"{timestamp}_{uuid.uuid4().hex[:8]}.{ext}"
    file_path = UPLOAD_DIR / unique_name

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

    url = f"{base}/files/{unique_name}"

    return {
        "success": True,
        "filename": unique_name,
        "url": url,
        "size_bytes": len(content),
        "content_type": MIME_MAP.get(ext, "application/octet-stream"),
        "extension": ext,
    }


# ---------------------------------------------------------------------------
# These legacy routes redirect to /files/{filename} or /files for backward
# compatibility with existing workflows that reference /images/{filename}.
# ---------------------------------------------------------------------------

def _serve_file(filename: str):
    """Internal: serve a file from UPLOAD_DIR."""
    file_path = UPLOAD_DIR / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    # Safety: ensure the resolved path is inside UPLOAD_DIR
    if UPLOAD_DIR not in file_path.resolve().parents and file_path.resolve() != UPLOAD_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid filename")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    media_type = MIME_MAP.get(ext, "application/octet-stream")
    return FileResponse(str(file_path), media_type=media_type, filename=filename)


@app.delete("/images/{filename}")
async def delete_legacy_image(
    filename: str,
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
):
    """
    Delete an uploaded file. Requires API key.
    (Legacy /images/ endpoint — maintained for backward compat.)
    """
    check_api_key(x_api_key, api_key)
    file_path = UPLOAD_DIR / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if UPLOAD_DIR not in file_path.resolve().parents and file_path.resolve() != UPLOAD_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path.unlink()
    return {"success": True, "filename": filename, "deleted": True}


@app.get("/images")
async def list_legacy_images(
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
):
    """
    List all uploaded files. Requires API key.
    (Legacy /images/ endpoint — maintained for backward compat.)
    """
    return await list_files_internal(x_api_key, api_key)


@app.get("/images/{filename:path}")
async def serve_legacy_image(filename: str):
    """
    Serve a file stored at /app/uploads/{filename}.
    (Legacy /images/ endpoint — maintained for backward compat.)
    """
    return _serve_file(filename)


# ---------------------------------------------------------------------------
# New canonical routes under /files/{filename}
# ---------------------------------------------------------------------------


@app.delete("/files/{filename}")
async def delete_file(
    filename: str,
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
):
    """Delete an uploaded file. Requires API key."""
    check_api_key(x_api_key, api_key)
    file_path = UPLOAD_DIR / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if UPLOAD_DIR not in file_path.resolve().parents and file_path.resolve() != UPLOAD_DIR.resolve():
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path.unlink()
    return {"success": True, "filename": filename, "deleted": True}


async def list_files_internal(x_api_key=None, api_key=None):
    """Internal: list all uploaded files."""
    check_api_key(x_api_key, api_key)
    files = []
    for f in sorted(UPLOAD_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.is_file():
            ext = f.name.rsplit(".", 1)[-1].lower() if "." in f.name else ""
            files.append({
                "filename": f.name,
                "size_bytes": f.stat().st_size,
                "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(f.stat().st_mtime)),
                "content_type": MIME_MAP.get(ext, "application/octet-stream"),
            })
    return {"count": len(files), "files": files}


@app.get("/files")
async def list_files(
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
):
    """List all uploaded files. Requires API key."""
    return await list_files_internal(x_api_key, api_key)


@app.get("/admin", response_class=HTMLResponse)
async def admin_panel(
    x_api_key: str | None = Header(None),
    api_key: str | None = Query(None),
):
    """
    Admin management page for browsing and deleting uploaded files.

    Requires API key if UPLOAD_API_KEY is configured (same auth as /files).
    Open this in your browser to manage storage when the server gets full.
    """
    check_api_key(x_api_key, api_key)
    return ADMIN_HTML


# ---------------------------------------------------------------------------
# Static file serving — mounted LAST so routes match first.
# We mount BOTH /files and /images for backward compatibility.
# ---------------------------------------------------------------------------

app.mount("/files", StaticFiles(directory=str(UPLOAD_DIR)), name="files_static")
app.mount("/images", StaticFiles(directory=str(UPLOAD_DIR)), name="images_static_legacy")


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.getenv("PORT", "8001"))
    uvicorn.run(app, host="0.0.0.0", port=port)
