import express from "express";
import cors from "cors";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "/data/output";
const CALLBACK_RETRIES = 3;

fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Resolution presets
const RESOLUTIONS: Record<string, { width: number; height: number }> = {
  preview: { width: 512, height: 288 },
  mobile: { width: 640, height: 360 },
  sd: { width: 1024, height: 576 },
  hd: { width: 1280, height: 720 },
  "1080": { width: 1920, height: 1080 },
  "4k": { width: 3840, height: 2160 },
};

// Bundle the Remotion project once at startup
let bundledPath: string | null = null;

async function getBundle(): Promise<string> {
  if (bundledPath) return bundledPath;
  console.log("Bundling Remotion project...");
  bundledPath = await bundle({
    entryPoint: path.resolve(__dirname, "Root.tsx"),
    webpackOverride: (config) => config,
  });
  console.log("Bundle ready:", bundledPath);
  return bundledPath;
}

// Send callback webhook
async function sendCallback(callbackUrl: string, payload: any) {
  for (let attempt = 1; attempt <= CALLBACK_RETRIES; attempt++) {
    try {
      const res = await fetch(callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) return;
    } catch {
      // retry
    }
    if (attempt < CALLBACK_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
    }
  }
}

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", engine: "remotion" });
});

// Start render
app.post("/edit/v1/render", async (req, res) => {
  try {
    const { timeline, output, callback } = req.body;
    const renderId = nanoid(21);

    // Resolve output dimensions
    const preset = RESOLUTIONS[output?.resolution ?? "sd"] ?? RESOLUTIONS.sd;
    const width = output?.size?.width ?? preset.width;
    const height = output?.size?.height ?? preset.height;
    const fps = output?.fps ?? 25;

    // Calculate total duration
    const totalDuration = (timeline?.tracks ?? []).reduce(
      (max: number, track: any) => {
        const trackEnd = (track.clips ?? []).reduce(
          (end: number, c: any) => Math.max(end, c.start + c.length),
          0
        );
        return Math.max(max, trackEnd);
      },
      0
    );

    if (totalDuration <= 0) {
      return res.status(400).json({
        success: false,
        message: "Timeline has no clips with positive duration",
      });
    }

    const totalFrames = Math.round(totalDuration * fps);

    // Spawn async render
    res.status(201).json({
      success: true,
      message: "Created",
      response: {
        id: renderId,
        owner: "remotion",
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
        const bundle = await getBundle();
        const outputPath = path.join(OUTPUT_DIR, renderId, "output.mp4");
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        const inputProps = { timeline, output: { ...output, width, height, fps } };

        const compositionId = "VideoComposition";

        const composition = await selectComposition({
          serveUrl: bundle,
          id: compositionId,
          inputProps,
        });

        // Override duration/resolution from request
        composition.durationInFrames = totalFrames;
        composition.fps = fps;
        composition.width = width;
        composition.height = height;

        const crfValue = 22; // lower = better quality (18-28 range)
        await renderMedia({
          composition,
          serveUrl: bundle,
          codec: "h264",
          outputLocation: outputPath,
          inputProps,
          crf: crfValue,
          chromiumOptions: {
            enableMultiProcessOnLinux: true,
          },
        });

        const assetUrl = `/serve/v1/assets/${renderId}/output.mp4`;

        // Fire callback if configured
        if (callback) {
          const payload = {
            type: "render",
            action: "render",
            id: renderId,
            owner: "remotion",
            status: "done",
            url: assetUrl,
            error: null,
            completed: new Date().toISOString(),
          };
          await sendCallback(callback, payload);
        }
      } catch (error: any) {
        console.error("Render failed:", error);

        if (callback) {
          const payload = {
            type: "render",
            action: "render",
            id: renderId,
            owner: "remotion",
            status: "failed",
            url: null,
            error: error.message,
            completed: new Date().toISOString(),
          };
          await sendCallback(callback, payload);
        }
      }
    })();
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Serve rendered videos
app.use(
  "/serve/v1/assets",
  express.static(OUTPUT_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".mp4")) {
        res.setHeader("Content-Type", "video/mp4");
      }
    },
  })
);

// Get render status (simplified — Remotion renders are synchronous per-job)
app.get("/edit/v1/render/:id", async (req, res) => {
  const { id } = req.params;
  const outputPath = path.join(OUTPUT_DIR, id, "output.mp4");

  const exists = fs.existsSync(outputPath);

  res.json({
    success: true,
    message: "OK",
    response: {
      id,
      owner: "remotion",
      status: exists ? "done" : "rendering",
      url: exists ? `/serve/v1/assets/${id}/output.mp4` : null,
      error: null,
      created: "",
      updated: new Date().toISOString(),
    },
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Remotion Server v1.0.0 listening on http://0.0.0.0:${PORT}`);
});
