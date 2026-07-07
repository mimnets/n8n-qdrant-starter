import {
  AbsoluteFill, Img, Audio, useCurrentFrame, useVideoConfig,
  interpolate, Easing, spring, Sequence, springTiming,
} from "remotion";
import { createTikTokStyleCaptions } from "@remotion/captions";

// ================================================================
// Types
// ================================================================
type KenBurnsEffect =
  | "zoomIn" | "zoomOut" | "slideLeft" | "slideRight"
  | "slideUp" | "slideDown" | "zoomInFast" | "zoomOutFast";

type TextAnimation = "none" | "fadeIn" | "slideUp" | "scale" | "typewriter";
type CaptionStyle = "static" | "tiktok";

interface Transition { in?: string; out?: string; }

interface FontStyle { family?: string; size?: number; color?: string; weight?: number; }

interface TextAsset {
  type: "text";
  text?: string;
  font?: FontStyle;
  alignment?: { horizontal?: string; vertical?: string };
  background?: string;
  captionStyle?: CaptionStyle;
  combineMs?: number;
}

interface ImageAsset { type: "image"; src?: string; }
interface HtmlAsset { type: "html"; html?: string; }
type Asset = TextAsset | ImageAsset | HtmlAsset;

interface Clip {
  asset: Asset;
  start: number;
  length: number;
  effect?: KenBurnsEffect;
  transition?: Transition;
  textAnimation?: TextAnimation;
}

interface Track { clips: Clip[]; }
interface Timeline { background?: string; soundtrack?: { src?: string; effect?: string; volume?: number }; tracks: Track[]; }
interface Output { format?: string; resolution?: string; fps?: number; }
interface RenderRequest { timeline: Timeline; output: Output; }

// ================================================================
// Helpers
// ================================================================
function getTextPos(
  alignment?: TextAsset["alignment"]
): React.CSSProperties {
  const h = alignment?.horizontal ?? "center";
  const v = alignment?.vertical ?? "bottom";
  let left: string | number = "50%";
  let tx = "-50%";
  if (h === "left") { left = 40; tx = "0"; }
  else if (h === "right") { left = "auto"; tx = "0"; }
  let bottom: string | number | undefined;
  let top: string | number | undefined;
  let ty = "0";
  if (v === "bottom") { bottom = 80; }
  else if (v === "top") { top = 80; }
  else { top = "50%"; ty = "-50%"; }
  return {
    position: "absolute",
    left: h === "right" ? "auto" : left,
    right: h === "right" ? 40 : "auto",
    top: top ?? "auto", bottom: bottom ?? "auto",
    transform: `translate(${tx}, ${ty})`,
    display: "flex", justifyContent: "center", alignItems: "center",
    width: "auto", height: "auto", maxWidth: "80%",
  };
}

function getKenBurns(effect: KenBurnsEffect | undefined, frame: number, total: number): React.CSSProperties {
  const p = frame / Math.max(total - 1, 1);
  const ep = Easing.inOut(Easing.ease)(Math.min(p, 1));
  switch (effect) {
    case "zoomIn": case "zoomInFast": {
      const s = effect === "zoomInFast" ? 2 : 1;
      return { transform: `scale(${interpolate(ep, [0,1], [1, 1+0.3*s])})` };
    }
    case "zoomOut": case "zoomOutFast": {
      const s = effect === "zoomOutFast" ? 2 : 1;
      return { transform: `scale(${interpolate(ep, [0,1], [1+0.3*s, 1])})` };
    }
    case "slideLeft": return { transform: `translateX(${interpolate(ep,[0,1],[0,-100])}px)` };
    case "slideRight": return { transform: `translateX(${interpolate(ep,[0,1],[0,100])}px)` };
    case "slideUp": return { transform: `translateY(${interpolate(ep,[0,1],[0,-100])}px)` };
    case "slideDown": return { transform: `translateY(${interpolate(ep,[0,1],[0,100])}px)` };
    default: return {};
  }
}

/** Generate estimated word-level captions from plain text + total duration */
function textToCaptions(text: string, totalDurationMs: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const msPerWord = totalDurationMs / words.length;
  return words.map((word, i) => ({
    text: i === 0 ? word : ` ${word}`,
    startMs: Math.round(i * msPerWord),
    endMs: Math.round((i + 1) * msPerWord),
    timestampMs: Math.round(i * msPerWord),
    confidence: null as number | null,
  }));
}

// ================================================================
// Animated text style helper
// ================================================================
function getTextAnimationStyle(
  animation: TextAnimation | undefined,
  frame: number,
  totalFrames: number,
): React.CSSProperties {
  if (!animation || animation === "none" || totalFrames <= 0) return {};
  const progress = Math.min(frame / totalFrames, 1);
  switch (animation) {
    case "fadeIn":
      return { opacity: interpolate(progress, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) };
    case "slideUp":
      return {
        opacity: interpolate(progress, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        transform: `translateY(${interpolate(progress, [0, 0.4], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
      };
    case "scale":
      return {
        opacity: interpolate(progress, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        transform: `scale(${interpolate(progress, [0, 0.4], [0.8, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })})`,
      };
    case "typewriter":
      return { opacity: 1 };
    default: return {};
  }
}

// ================================================================
// Image Scene
// ================================================================
const ImageScene: React.FC<{ clip: Clip; totalFrames: number }> = ({ clip, totalFrames }) => {
  const frame = useCurrentFrame();
  const kb = getKenBurns(clip.effect as KenBurnsEffect, frame, totalFrames);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img src={clip.asset.src!} style={{ width: "100%", height: "100%", objectFit: (clip as any).fit || "cover", ...kb }} />
    </AbsoluteFill>
  );
};

// ================================================================
// Static Text Overlay (with animations)
// ================================================================
const TextOverlay: React.FC<{ clip: Clip; width: number; height: number; clipFrames?: number }> = ({
  clip, width, height, clipFrames = 0,
}) => {
  const frame = useCurrentFrame();
  const asset = clip.asset as TextAsset;
  const font = asset.font ?? {};
  const align = asset.alignment ?? {};
  const animStyle = getTextAnimationStyle(clip.textAnimation as TextAnimation | undefined, frame, clipFrames);

  if (asset.captionStyle === "tiktok") {
    return <TikTokCaptionOverlay clip={clip} width={width} height={height} />;
  }

  return (
    <AbsoluteFill style={{ ...getTextPos(align), pointerEvents: "none" }}>
      <div style={{
        fontFamily: font.family ?? "sans-serif",
        fontSize: (font.size ?? 42) * (width / 1920),
        color: font.color ?? "#FFFFFF",
        fontWeight: font.weight ?? 400,
        textAlign: "center",
        textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
        maxWidth: "80%", lineHeight: 1.4,
        padding: "12px 24px",
        background: asset.background ?? "rgba(0,0,0,0.3)",
        borderRadius: "8px",
        ...animStyle,
      }}>
        {clip.textAnimation === "typewriter"
          ? asset.text?.slice(0, Math.floor(frame / clipFrames * (asset.text?.length ?? 0))) ?? ""
          : asset.text}
      </div>
    </AbsoluteFill>
  );
};

// ================================================================
// TikTok-Style Captions (word-by-word highlight)
// ================================================================
const TikTokCaptionOverlay: React.FC<{ clip: Clip; width: number; height: number }> = ({ clip, width, height }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const asset = clip.asset as TextAsset;
  const align = asset.alignment ?? {};
  const combineMs = asset.combineMs ?? 400; // word-by-word by default

  // Generate estimated captions from plain text
  const totalMs = clip.length * 1000;
  const captions = textToCaptions(asset.text ?? "", totalMs);

  // Create TikTok-style pages
  const { pages } = createTikTokStyleCaptions({
    captions,
    combineTokensWithinMilliseconds: combineMs,
  });

  const timeMs = (frame / fps) * 1000;
  let currentPage = pages.find(
    (p) => timeMs >= p.startMs && timeMs < p.startMs + (p.durationMs ?? totalMs - p.startMs)
  );

  // If between pages or past last page, show the nearest preceding page
  if (!currentPage && pages.length > 0) {
    for (const p of pages) {
      if (p.startMs <= timeMs) currentPage = p;
    }
    // If still null (before first page), use first page
    if (!currentPage) currentPage = pages[0];
  }

  if (!currentPage) return null;

  return (
    <AbsoluteFill style={{ ...getTextPos(align), pointerEvents: "none" }}>
      <div style={{
        position: "relative",
        display: "flex", flexWrap: "wrap",
        justifyContent: "center", alignItems: "center",
        gap: "2px",
        fontFamily: (asset.font?.family ?? "sans-serif") as string,
        fontSize: ((asset.font?.size ?? 48) * (width / 1920)) as number,
        fontWeight: (asset.font?.weight ?? 700) as number,
        whiteSpace: "pre-wrap",
        textAlign: "center",
        lineHeight: 1.5,
      }}>
        {currentPage.tokens.map((token, i) => {
          const isActive = timeMs >= token.fromMs && timeMs < token.toMs;
          return (
            <span
              key={i}
              style={{
                color: isActive ? "#FFD700" : (asset.font?.color ?? "#FFFFFF"),
                textShadow: isActive
                  ? "0 0 12px #FFD700, 0 0 24px #FFD700, 2px 2px 4px rgba(0,0,0,0.8)"
                  : "2px 2px 4px rgba(0,0,0,0.8)",
                background: isActive ? "rgba(0,0,0,0.5)" : "transparent",
                borderRadius: "4px",
                padding: isActive ? "2px 4px" : "2px 0",
                transition: "all 0.05s ease",
                whiteSpace: "pre",
              }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ================================================================
// HTML Scene
// ================================================================
const HtmlScene: React.FC<{ clip: Clip; width: number; height: number }> = ({ clip, width, height }) => (
  <AbsoluteFill style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div style={{ width: "100%", height: "100%" }}
      dangerouslySetInnerHTML={{ __html: (clip.asset as HtmlAsset).html ?? "" }} />
  </AbsoluteFill>
);

// ================================================================
// Audio Clip
// ================================================================
const AudioClip: React.FC<{ src: string; volume?: number }> = ({ src, volume = 1 }) => (
  <Audio src={src} volume={volume} />
);

// ================================================================
// Crossfade between clips
// ================================================================
const CrossfadeLayer: React.FC<{
  clips: Clip[];
  currentTime: number;
  fps: number;
  width: number;
  height: number;
}> = ({ clips, currentTime, fps, width, height }) => {
  // Find all clips active at this moment
  const activeClips = clips.filter(
    (c) => c.asset.type !== "text" && c.asset.type !== "audio" &&
      currentTime >= c.start && currentTime < c.start + c.length
  );

  if (activeClips.length === 0) return null;
  if (activeClips.length === 1) {
    const c = activeClips[0];
    const cf = Math.round(c.length * fps);
    return <ImageScene clip={c} totalFrames={cf} />;
  }

  // Multiple clips overlapping = crossfade
  return (
    <>
      {activeClips.map((c, i) => {
        const cf = Math.round(c.length * fps);
        const localTime = currentTime - c.start;
        let opacity = 1;
        if (i === activeClips.length - 1) {
          // Latest clip fades in
          opacity = interpolate(localTime, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        } else if (localTime < c.length - 0.3) {
          // Earlier clip fades out at end
          const remaining = c.length - localTime;
          opacity = interpolate(remaining, [0, 0.3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        }
        return (
          <div key={i} style={{ position: "absolute", inset: 0, opacity }}>
            <ImageScene clip={c} totalFrames={cf} />
          </div>
        );
      })}
    </>
  );
};

// ================================================================
// Main Composition
// ================================================================
export const VideoComposition: React.FC<RenderRequest> = ({ timeline, output }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const currentTime = frame / fps;

  // Separate clips by type
  const videoClips = timeline.tracks.flatMap((t) =>
    t.clips.filter((c) => c.asset.type !== "audio")
  );
  const audioClips = timeline.tracks.flatMap((t) =>
    t.clips.filter((c) => c.asset.type === "audio")
  );

  // Active visual clips (for crossfade) and text clips
  const visualClips = videoClips.filter((c) => c.asset.type !== "text");
  const textClips = videoClips.filter(
    (c) => c.asset.type === "text" &&
      currentTime >= c.start && currentTime < c.start + c.length
  );

  // Black background if nothing active
  const hasVideo = visualClips.some(
    (c) => currentTime >= c.start && currentTime < c.start + c.length
  );
  if (!hasVideo && textClips.length === 0 && audioClips.length === 0) {
    return <AbsoluteFill style={{ background: timeline.background ?? "#000" }} />;
  }

  return (
    <AbsoluteFill style={{ background: timeline.background ?? "#000" }}>
      {/* Visual content with crossfade */}
      <CrossfadeLayer clips={visualClips} currentTime={currentTime} fps={fps} width={width} height={height} />

      {/* Text overlays always on top */}
      {textClips.map((c, i) => {
        const clipFrames = Math.round(c.length * fps);
        return <TextOverlay key={i} clip={c} width={width} height={height} clipFrames={clipFrames} />;
      })}

      {/* Soundtrack */}
      {timeline.soundtrack?.src && (
        <Audio src={timeline.soundtrack.src} volume={timeline.soundtrack.volume ?? 0.15} />
      )}

      {/* Audio clips — Sequence with durationInFrames.
          Audio mounts at scene start, unmounts at scene end.
          Scene duration should match or exceed actual audio length. */}
      {audioClips.map((c, i) => {
        const from = Math.round(c.start * fps);
        const dur = Math.round(c.length * fps);
        return (
          <Sequence key={i} from={from} durationInFrames={dur}>
            <Audio src={c.asset.src ?? ""} volume={1} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
