import type { Caption } from "@remotion/captions";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";

import captionData from "../captions.json";
import { COLORS, FONT_SANS } from "../theme.ts";

const captions: readonly Caption[] = captionData;

export const CaptionTrack = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const nowMs = (frame / fps) * 1000;
  const caption = captions.find(
    (item) => item.startMs <= nowMs && item.endMs > nowMs
  );

  if (caption === undefined) {
    return null;
  }

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "flex-end",
        pointerEvents: "none"
      }}
    >
      <div
        style={{
          background: "rgba(23,25,31,0.92)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 18,
          boxShadow: "0 14px 40px rgba(23,25,31,0.18)",
          color: COLORS.white,
          fontFamily: FONT_SANS,
          fontSize: 27,
          fontWeight: 700,
          lineHeight: 1.35,
          marginBottom: 32,
          maxWidth: 1420,
          padding: "17px 30px",
          textAlign: "center"
        }}
      >
        {caption.text}
      </div>
    </AbsoluteFill>
  );
};
