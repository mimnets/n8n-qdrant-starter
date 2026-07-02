import { registerRoot, Composition } from "remotion";
import { VideoComposition } from "./compositions/VideoComposition";

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="VideoComposition"
        component={VideoComposition}
        durationInFrames={300}
        fps={25}
        width={1920}
        height={1080}
        defaultProps={{
          timeline: {
            background: "#000000",
            tracks: [
              {
                clips: [
                  {
                    asset: {
                      type: "image",
                      src: "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1920&h=1080&fit=crop",
                    },
                    start: 0,
                    length: 6,
                    effect: "zoomIn",
                    transition: { in: "fade" },
                  },
                ],
              },
              {
                clips: [
                  {
                    asset: {
                      type: "text",
                      text: "Sample Text Overlay",
                      font: { family: "sans-serif", size: 48, color: "#FFFFFF" },
                      alignment: { horizontal: "center", vertical: "bottom" },
                    },
                    start: 0,
                    length: 6,
                    position: "bottom",
                  },
                ],
              },
            ],
            soundtrack: undefined,
          },
          output: { format: "mp4", resolution: "1080" },
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
