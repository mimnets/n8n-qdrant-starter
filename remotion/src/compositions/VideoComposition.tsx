import { AbsoluteFill, Img, Audio, useCurrentFrame, useVideoConfig, interpolate, Easing, spring, Sequence } from "remotion";

// Ken Burns effect presets
type KenBurnsEffect =
  | "zoomIn"
  | "zoomOut"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "zoomInFast"
  | "zoomOutFast";

interface Transition {
  in?: string;
  out?: string;
}

interface FontStyle {
  family?: string;
  size?: number;
  color?: string;
  weight?: number;
}

interface TextAsset {
  type: "text";
  text?: string;
  font?: FontStyle;
  alignment?: { horizontal?: string; vertical?: string };
  background?: string;
}

interface ImageAsset {
  type: "image";
  src?: string;
}

interface HtmlAsset {
  type: "html";
  html?: string;
}

type Asset = TextAsset | ImageAsset | HtmlAsset;

interface Clip {
  asset: Asset;
  start: number;
  length: number;
  effect?: KenBurnsEffect;
  transition?: Transition;
  position?: string;
  offset?: { x?: number; y?: number };
}

interface Track {
  clips: Clip[];
}

interface Timeline {
  background?: string;
  soundtrack?: { src?: string; effect?: string; volume?: number };
  tracks: Track[];
}

interface Output {
  format?: string;
  resolution?: string;
  fps?: number;
}

interface RenderRequest {
  timeline: Timeline;
  output: Output;
}

// Resolution presets
const RESOLUTIONS: Record<string, { width: number; height: number }> = {
  preview: { width: 512, height: 288 },
  mobile: { width: 640, height: 360 },
  sd: { width: 1024, height: 576 },
  hd: { width: 1280, height: 720 },
  "1080": { width: 1920, height: 1080 },
  "4k": { width: 3840, height: 2160 },
};

// Ken Burns CSS transform generator
function getKenBurnsTransform(
  effect: KenBurnsEffect | undefined,
  frame: number,
  totalFrames: number
): React.CSSProperties {
  const progress = frame / Math.max(totalFrames - 1, 1);
  const easedProgress = Easing.inOut(Easing.ease)(Math.min(progress, 1));

  switch (effect) {
    case "zoomIn":
    case "zoomInFast": {
      const speed = effect === "zoomInFast" ? 2.0 : 1.0;
      const scale = interpolate(
        easedProgress,
        [0, 1],
        [1, 1 + 0.3 * speed],
        { extrapolateRight: "clamp" }
      );
      return { transform: `scale(${scale})` };
    }
    case "zoomOut":
    case "zoomOutFast": {
      const speed = effect === "zoomOutFast" ? 2.0 : 1.0;
      const scale = interpolate(
        easedProgress,
        [0, 1],
        [1 + 0.3 * speed, 1],
        { extrapolateRight: "clamp" }
      );
      return { transform: `scale(${scale})` };
    }
    case "slideLeft": {
      const x = interpolate(easedProgress, [0, 1], [0, -100], {
        extrapolateRight: "clamp",
      });
      return { transform: `translateX(${x}px)` };
    }
    case "slideRight": {
      const x = interpolate(easedProgress, [0, 1], [0, 100], {
        extrapolateRight: "clamp",
      });
      return { transform: `translateX(${x}px)` };
    }
    case "slideUp": {
      const y = interpolate(easedProgress, [0, 1], [0, -100], {
        extrapolateRight: "clamp",
      });
      return { transform: `translateY(${y}px)` };
    }
    case "slideDown": {
      const y = interpolate(easedProgress, [0, 1], [0, 100], {
        extrapolateRight: "clamp",
      });
      return { transform: `translateY(${y}px)` };
    }
    default:
      return {};
  }
}

// Resolve text position
function getTextPosition(
  alignment?: { horizontal?: string; vertical?: string },
  position?: string
): React.CSSProperties {
  const h = alignment?.horizontal ?? position === "bottom" ? "center" : "center";
  const v = alignment?.vertical ?? position === "bottom" ? "flex-end" : "center";

  return {
    display: "flex",
    alignItems:
      v === "top" ? "flex-start" : v === "bottom" ? "flex-end" : "center",
    justifyContent:
      h === "left"
        ? "flex-start"
        : h === "right"
          ? "flex-end"
          : "center",
  };
}

// ================================================================
// Image Scene with Ken Burns
// ================================================================
const ImageScene: React.FC<{
  clip: Clip;
  totalFrames: number;
}> = ({ clip, totalFrames }) => {
  const frame = useCurrentFrame();
  const kenBurns = getKenBurnsTransform(
    clip.effect as KenBurnsEffect,
    frame,
    totalFrames
  );

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={clip.asset.src!}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          ...kenBurns,
        }}
      />
    </AbsoluteFill>
  );
};

// ================================================================
// Text/Caption Overlay
// ================================================================
const TextOverlay: React.FC<{
  clip: Clip;
  width: number;
  height: number;
}> = ({ clip, width, height }) => {
  const asset = clip.asset as TextAsset;
  const font = asset.font ?? {};
  const align = asset.alignment ?? {};

  // Padding from edges
  const padBottom = Math.round(height * 0.1);
  const padHorizontal = 40;

  const posStyle = getTextPosition(align, clip.position);

  return (
    <AbsoluteFill
      style={{
        ...posStyle,
        padding: `${padBottom}px ${padHorizontal}px`,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: font.family ?? "sans-serif",
          fontSize: (font.size ?? 42) * (width / 1920),
          color: font.color ?? "#FFFFFF",
          fontWeight: font.weight ?? 400,
          textAlign: "center",
          textShadow: "2px 2px 4px rgba(0,0,0,0.8)",
          maxWidth: "80%",
          lineHeight: 1.4,
          padding: "12px 24px",
          background: asset.background ?? "rgba(0,0,0,0.3)",
          borderRadius: "8px",
        }}
      >
        {asset.text}
      </div>
    </AbsoluteFill>
  );
};

// ================================================================
// HTML Scene (rich text with background)
// ================================================================
const HtmlScene: React.FC<{
  clip: Clip;
  width: number;
  height: number;
}> = ({ clip, width, height }) => {
  return (
    <AbsoluteFill
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{ width: "100%", height: "100%" }}
        dangerouslySetInnerHTML={{
          __html: (clip.asset as HtmlAsset).html ?? "",
        }}
      />
    </AbsoluteFill>
  );
};

// ================================================================
// Audio Clip
// ================================================================
const AudioClip: React.FC<{
  src: string;
  volume?: number;
  startInFrame: number;
  durationInFrames: number;
}> = ({ src, volume = 1 }) => {
  return <Audio src={src} volume={volume} />;
};

// ================================================================
// Main Composition
// ================================================================
export const VideoComposition: React.FC<RenderRequest> = ({
  timeline,
  output,
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();

  // Calculate total duration from tracks
  const totalDuration = timeline.tracks.reduce((maxDur, track) => {
    const trackEnd = track.clips.reduce((end, c) => Math.max(end, c.start + c.length), 0);
    return Math.max(maxDur, trackEnd);
  }, 0);

  const totalFrames = Math.round(totalDuration * fps);

  // Separate audio and video tracks
  const videoClips = timeline.tracks.flatMap((track) =>
    track.clips.filter((c) => c.asset.type !== "audio")
  );
  const audioClips = timeline.tracks.flatMap((c) =>
    c.clips?.filter((c) => c.asset.type === "audio") ?? []
  );

  // Find which clip is active at current frame
  const currentTime = frame / fps;
  const activeClip = videoClips.find(
    (c) => currentTime >= c.start && currentTime < c.start + c.length
  );

  if (!activeClip) {
    return <AbsoluteFill style={{ background: timeline.background ?? "#000" }} />;
  }

  const clipFrames = Math.round(activeClip.length * fps);
  const clipStartFrame = Math.round(activeClip.start * fps);
  const localFrame = frame - clipStartFrame;

  // Fade transition at start/end of clip
  let opacity = 1;
  if (activeClip.transition?.in && localFrame < 10) {
    opacity = interpolate(localFrame, [0, 10], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }
  if (activeClip.transition?.out && clipFrames - localFrame < 10) {
    const remaining = clipFrames - localFrame;
    opacity = interpolate(remaining, [0, 10], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  }

  return (
    <AbsoluteFill
      style={{
        background: timeline.background ?? "#000",
        opacity,
      }}
    >
      {/* Image/HTML content */}
      {activeClip.asset.type === "image" && (
        <ImageScene clip={activeClip} totalFrames={clipFrames} />
      )}
      {activeClip.asset.type === "html" && (
        <HtmlScene clip={activeClip} width={width} height={height} />
      )}

      {/* Text overlay (always on top) */}
      {videoClips
        .filter(
          (c) =>
            c.asset.type === "text" &&
            currentTime >= c.start &&
            currentTime < c.start + c.length
        )
        .map((c, i) => (
          <TextOverlay key={i} clip={c} width={width} height={height} />
        ))}

      {/* Soundtrack (plays throughout) */}
      {timeline.soundtrack?.src && (
        <Audio
          src={timeline.soundtrack.src}
          volume={timeline.soundtrack.volume ?? 0.15}
        />
      )}

      {/* Audio clips (scene-specific audio) */}
      {audioClips.map((c, i) => {
        const clipStartInFrames = Math.round(c.start * fps);
        const clipDurationInFrames = Math.round(c.length * fps);
        return (
          <Sequence
            key={i}
            from={clipStartInFrames}
            durationInFrames={clipDurationInFrames}
          >
            <AudioClip
              src={c.asset.src ?? ""}
              volume={1}
              startInFrame={0}
              durationInFrames={clipDurationInFrames}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
