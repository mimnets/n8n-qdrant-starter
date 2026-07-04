# Remotion Render — Feature Roadmap & Memory

Saved: 2026-07-04
From: Discord #n8n-qdrant-starter conversation with Monirul Islam (mimnets)

## Current State

The n8n-nodes-remotion-render community node is published to npm (v0.1.1).
Remotion server runs at http://remotion:3000 with:
- Images with Ken Burns effects (zoom, slide, pan)
- Text overlays with absolute positioning (bottom, center, top, left, right)
- Multi-track audio + background soundtrack
- Fade transitions
- HTML scenes
- Dynamic input OR manual UI mode

## Phase A — Low effort, high impact

**1. Animated text entrances**
Text slides/fades in instead of appearing instantly.
- Changes to: VideoComposition.tsx (TextOverlay component) + node UI (new animation fields)
- Payload: `"textAnimation": { "in": "slideUp|fade|scale", "out": "fade", "duration": 0.5 }`

**2. Crossfade between sequential images**
Smooth dissolve instead of hard cut between overlapping images.
- Changes to: VideoComposition.tsx (detect overlapping clips + render blend)
- No node changes needed if auto-detected

**3. Auto-duration from audio**
Images auto-calculate length to match audio duration — one less thing to figure out.
- Changes to: RemotionRender.node.ts (build-timeline logic)
- Add option in node: "Auto-fit to audio"

**4. Vertical video mode (TikTok/Reels)**
New resolution preset `vertical` (1080×1920) with repositioned text.
- Changes to: server.ts (add resolution preset) + node UI (add option)

## Phase B — Medium effort

**5. Lower thirds**
Professional name/title overlays that slide in from left.
- Payload: `"lowerThird": { "title": "...", "subtitle": "...", "start": 0, "length": 5 }`

**6. Picture-in-picture**
Small overlay video/image in corner while main plays.

**7. Text-to-speech via Kokoro TTS**
Voiceover field auto-generates speech → downloads audio → syncs captions.

**8. Word-by-word TikTok captions**
Using `@remotion/captions` `createTikTokStyleCaptions()`.

## Phase C — Higher effort

**9. Video clips as assets**
Support .mp4 video files (not just images).

**10. Data-driven animated charts**
Bar/line charts for faceless YouTube videos.

**11. Multi-clip templates**
Side-by-side, before/after, grid layouts.

**12. Animated gradient backgrounds**

## Phase D — Long-term

**13. AI script-to-video pipeline**
Script → TTS → Image gen (Flux) → Timeline → Render → Post.

**14. Real-time render progress webhooks**

**15. n8n node multi-operation (Bulk Render, Generate from Script)**

## How to Resume

To restart implementation, search for "remotion roadmap feature [feature name]" or say "continue remotion phase [A/B/C/D]".
The source files are at:
- Server rendering: /home/ubuntu/n8n-qdrant-starter/remotion/src/compositions/VideoComposition.tsx
- Server API: /home/ubuntu/n8n-qdrant-starter/remotion/src/server.ts
- n8n node: /home/ubuntu/n8n-qdrant-starter/n8n-nodes-remotion-render/
- Builder tool: http://remotion:3000/tools/api-builder
