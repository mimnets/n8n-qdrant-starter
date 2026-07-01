# File Upload Server

Self-hosted file upload service — replaces imgbb/imgur for both **images** and **audio** (mp3, wav, etc.), plus documents and archives. Designed for n8n workflow HTTP Request nodes.

Previously called "Image Upload" (v1). Migrated to "File Upload" (v2) to support non-image file types.

## Key Changes (Image → File Upload)

| What | v1 (Image Upload) | v2 (File Upload) |
|------|-------------------|-------------------|
| Name | `image-upload` | `file-upload` |
| Container | `n8n-image-upload` | `n8n-file-upload` |
| Docker image | `mimnets/n8n-image-upload:latest` | `mimnets/n8n-file-upload:latest` |
| Allowed types | Images only (png, jpg, gif, webp, etc.) | Images + Audio + Documents + Archives + Video |
| Max file size | 10 MB default | 50 MB default |
| URL prefix | `/images/{filename}` | `/files/{filename}` (with `/images/` backward compat) |
| Admin panel | "Image Upload Admin" | "File Upload Admin" |
| Response field | `content_type` | `content_type` + `extension` |

## Supported File Types

- **Images:** png, jpg, jpeg, gif, webp, bmp, svg, ico, tiff, tif
- **Audio:** mp3, wav, ogg, flac, aac, m4a, wma, opus
- **Documents:** pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv, json, xml, md
- **Archives:** zip, tar, gz, bz2, 7z, rar
- **Video:** mp4, mov, avi, mkv, webm

## API Endpoints

| Method | Endpoint | Description | Auth Required? |
|--------|----------|-------------|----------------|
| `GET` | `/health` | Health check | No |
| `POST` | `/upload` | Upload a file (multipart/form-data) | Only if API key set |
| `GET` | `/files/{filename}` | Serve/download a file | No |
| `GET` | `/files` | List all uploaded files | Yes |
| `DELETE` | `/files/{filename}` | Delete a file | Yes |
| `GET` | `/admin` | Browser-based admin GUI | Yes |
| `GET` | `/images/{filename}` | Legacy — serve file (backward compat) | No |
| `GET` | `/images` | Legacy — list files (backward compat) | Yes |
| `DELETE` | `/images/{filename}` | Legacy — delete file (backward compat) | Yes |

## Uploading to the Server

### From n8n (HTTP Request node)

**Settings:**

| Field | Value |
|-------|-------|
| **Method** | `POST` |
| **URL** | `http://file-upload:8001/upload` |
| **Send Body** | ✅ Enabled |
| **Content Type** | **Multipart Form Data** |
| **Body Parameters** | One entry: |
| | - Parameter Type: `Form Binary Data` |
| | - Name: `file` |
| | - Input Data Field Name: *your binary field name* |

**Code node (if needed to normalize binary):**

```javascript
const item = $input.item.json;
const binary = $input.item.binary;
const key = binary ? Object.keys(binary)[0] : null;
if (!key) return [{ json: { error: 'No file binary', ...item } }];
return [{ json: { ...item, file_ready: true }, binary: { fileData: binary[key] } }];
```

Then set Input Data Field Name to `fileData`.

**Response:**

```json
{
  "success": true,
  "filename": "20260630_100324_449862a3.txt",
  "url": "http://file-upload:8001/files/20260630_100324_449862a3.txt",
  "size_bytes": 34,
  "content_type": "text/plain",
  "extension": "txt"
}
```

Use `{{ $json.url }}` in downstream nodes.

### From curl

```bash
# Upload an image
curl -X POST http://localhost:8010/upload \
  -F "file=@photo.jpg"

# Upload an audio file (mp3)
curl -X POST http://localhost:8010/upload \
  -F "file=@podcast.mp3"

# Upload with API key
curl -X POST "http://localhost:8010/upload?api_key=YOUR_KEY" \
  -F "file=@document.pdf"
```

### Uploading audio from n8n

Same as uploading an image — use the **HTTP Request** node with `multipart/form-data` and the binary property from wherever you source the audio (file read, webhook binary, etc.).

## Backward Compatibility

The old `/images/{filename}` and `/images` endpoints still work, so existing n8n workflows referencing `http://image-upload:8001/images/...` continue to function. You don't need to update old workflows immediately.

However, **new workflows should use** `http://file-upload:8001/upload` → `/files/{filename}` going forward.

## Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8001` | Internal port |
| `UPLOAD_DIR` | `/app/uploads` | Storage directory |
| `UPLOAD_API_KEY` | *(empty)* | API key for auth (empty = open) |
| `MAX_FILE_SIZE_MB` | `50` | Max upload size in MB |
| `BASE_URL` | *(auto)* | External base URL for public URLs |

## Admin Panel

Browse and manage uploaded files at `http://<host>:8010/admin`.

If `UPLOAD_API_KEY` is set, add `?api_key=YOUR_KEY` to the URL or enter it in the prompt.

## Deployment

Built from `file-upload-server/` in the same repository.

```bash
# Build and start:
cd camofox-update
docker compose build file-upload
docker compose up -d file-upload

# Check logs:
docker logs n8n-file-upload

# Health check:
curl http://localhost:8010/health
```
