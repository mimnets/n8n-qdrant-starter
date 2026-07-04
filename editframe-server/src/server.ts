import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { nanoid } from "nanoid";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/data/output";
const RENDERS_DIR = path.join(OUTPUT_DIR, "jobs");
const CALLBACK_RETRIES = 3;

fs.mkdirSync(RENDERS_DIR, { recursive: true });

const RESOLUTIONS: Record<string, { width: number; height: number }> = {
  preview: { width: 512, height: 288 },
  mobile: { width: 640, height: 360 },
  sd: { width: 1024, height: 576 },
  hd: { width: 1280, height: 720 },
  "1080": { width: 1920, height: 1080 },
  "4k": { width: 3840, height: 2160 },
};

async function sendCallback(callbackUrl: string, payload: any) {
  for (let attempt = 1; attempt <= CALLBACK_RETRIES; attempt++) {
    try {
      const res = await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
    } catch {}
    if (attempt < CALLBACK_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", engine: "editframe" });
});

app.post("/edit/v1/render", async (req, res) => {
  try {
    const { html, output, callback, data } = req.body;

    if (!html) {
      return res.status(400).json({
        success: false,
        message: "Missing required field: html",
      });
    }

    const renderId = nanoid(21);
    const jobDir = path.join(RENDERS_DIR, renderId);
    const publicDir = path.join(jobDir, "public");
    fs.mkdirSync(publicDir, { recursive: true });

    const preset = RESOLUTIONS[output?.resolution ?? "sd"] ?? RESOLUTIONS.sd;
    const width = output?.size?.width ?? preset.width;
    const height = output?.size?.height ?? preset.height;
    const fps = output?.fps ?? 30;
    const durationMs = output?.duration ?? 5000;

    // Write composition HTML
    const compositionHtml = buildRenderHtml(html, width, height, data);
    fs.writeFileSync(path.join(publicDir, "index.html"), compositionHtml, "utf-8");

    const outputPath = path.join(jobDir, "output_tmp.webm");
    const finalPath = path.join(jobDir, "output.mp4");

    // Respond immediately
    res.status(201).json({
      success: true,
      message: "Created",
      response: {
        id: renderId,
        owner: "editframe",
        status: "rendering",
        url: null,
        data: null,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    });

    // Render in background
    (async () => {
      try {
        // Serve composition via a simple static server
        const staticServer = spawn("npx", [
          "serve", publicDir, "-p", "0", "--no-clipboard", "-L",
        ], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        // Get the port from server output
        const serverUrl: string = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Server start timeout")), 15000);
          const handler = (data: Buffer) => {
            const text = data.toString();
            const match = text.match(/http:\/\/localhost:(\d+)/);
            if (match) {
              clearTimeout(timeout);
              resolve(`http://localhost:${match[1]}`);
            }
          };
          staticServer.stdout?.on("data", handler);
          staticServer.stderr?.on("data", handler);
        });

        // Launch Playwright with viewport matching composition
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({
          headless: true,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
          ],
        });

        // Record video at composition dimensions
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: 1,
          recordVideo: {
            dir: jobDir,
            size: { width, height },
          },
        });

        const page = await context.newPage();
        await page.goto(serverUrl, { waitUntil: "networkidle", timeout: 30000 });

        // Wait for composition to complete (duration + buffer)
        await new Promise((r) => setTimeout(r, durationMs + 3000));

        await context.close();
        await browser.close();
        staticServer.kill();

        // Convert WebM -> MP4 with FFmpeg
        const recordedVideo = await page.video()?.path();
        if (!recordedVideo || !fs.existsSync(recordedVideo)) {
          throw new Error("No video recorded");
        }

        await new Promise<void>((resolve, reject) => {
          const ff = spawn("ffmpeg", [
            "-y",
            "-i", recordedVideo,
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-r", String(fps),
            finalPath,
          ], { stdio: "pipe" });
          ff.on("close", (code) => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`)));
          ff.on("error", reject);
        });

        const assetUrl = `/serve/v1/assets/${renderId}/output.mp4`;

        fs.writeFileSync(
          path.join(jobDir, "done.json"),
          JSON.stringify({ status: "done", url: assetUrl }),
          "utf-8"
        );

        if (callback) {
          await sendCallback(callback, {
            type: "render",
            action: "render",
            id: renderId,
            owner: "editframe",
            status: "done",
            url: assetUrl,
            error: null,
            completed: new Date().toISOString(),
          });
        }
      } catch (error: any) {
        const errMsg = error?.message || "Unknown error";
        console.error("Render failed:", errMsg);
        if (callback) {
          await sendCallback(callback, {
            type: "render",
            action: "render",
            id: renderId,
            owner: "editframe",
            status: "failed",
            url: null,
            error: errMsg,
            completed: new Date().toISOString(),
          });
        }
      }
    })();
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.use(
  "/serve/v1/assets",
  express.static(OUTPUT_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".mp4")) res.setHeader("Content-Type", "video/mp4");
    },
  })
);

app.get("/edit/v1/render/:id", async (req, res) => {
  const { id } = req.params;
  const donePath = path.join(RENDERS_DIR, id, "done.json");
  const outputPath = path.join(RENDERS_DIR, id, "output.mp4");

  let status = "rendering";
  let url: string | null = null;

  if (fs.existsSync(donePath)) {
    try {
      const done = JSON.parse(fs.readFileSync(donePath, "utf-8"));
      status = done.status;
      url = done.url;
    } catch {
      status = fs.existsSync(outputPath) ? "done" : "rendering";
      url = status === "done" ? `/serve/v1/assets/${id}/output.mp4` : null;
    }
  } else if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 100) {
    status = "done";
    url = `/serve/v1/assets/${id}/output.mp4`;
  }

  res.json({
    success: true,
    message: "OK",
    response: { id, owner: "editframe", status, url, error: null, created: "", updated: new Date().toISOString() },
  });
});

function buildRenderHtml(innerHtml: string, width: number, height: number, data: any): string {
  const dataScript = data ? `<script>window.__RENDER_DATA = ${JSON.stringify(data)};</script>` : "";
  const inner = innerHtml.trim().toLowerCase().startsWith("<!doctype") || innerHtml.trim().toLowerCase().startsWith("<html")
    ? innerHtml
    : `<ef-timegroup mode="contain" style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;">
        ${innerHtml}
      </ef-timegroup>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=${width}" />
  <script type="module" src="https://esm.sh/@editframe/elements@latest"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
  </style>
  ${dataScript}
</head>
<body style="width:${width}px;height:${height}px;">
  ${inner}
</body>
</html>`;
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Editframe Server v1.0.0 listening on http://0.0.0.0:${PORT}`);
});
