import type { ReactNode } from "react";
import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

import { COLORS, FONT_MONO } from "../theme.ts";

type TerminalProps = {
  readonly children: ReactNode;
  readonly label?: string;
};

export const Terminal = ({
  children,
  label = "sekisyo-demo"
}: TerminalProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({
    config: { damping: 200 },
    fps,
    frame,
    durationInFrames: Math.round(0.55 * fps)
  });

  return (
    <div
      style={{
        background: "#101217",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 22,
        boxShadow: "0 28px 80px rgba(23,25,31,0.22)",
        color: "#f4f5f8",
        height: "100%",
        overflow: "hidden",
        transform: `translateY(${interpolate(entrance, [0, 1], [30, 0])}px) scale(${interpolate(entrance, [0, 1], [0.985, 1])})`
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: "#1b1e26",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          height: 58,
          padding: "0 24px",
          position: "relative"
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          {[COLORS.red, "#f5b83d", COLORS.green].map((color) => (
            <div
              key={color}
              style={{
                background: color,
                borderRadius: "50%",
                height: 14,
                width: 14
              }}
            />
          ))}
        </div>
        <div
          style={{
            color: "#aeb3bd",
            fontFamily: FONT_MONO,
            fontSize: 17,
            left: 0,
            position: "absolute",
            right: 0,
            textAlign: "center"
          }}
        >
          {label}
        </div>
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 23,
          lineHeight: 1.55,
          padding: "30px 36px",
          whiteSpace: "pre-wrap"
        }}
      >
        {children}
      </div>
    </div>
  );
};

type RevealLineProps = {
  readonly at: number;
  readonly children: ReactNode;
  readonly color?: string;
  readonly indent?: number;
};

export const RevealLine = ({
  at,
  children,
  color = "#f4f5f8",
  indent = 0
}: RevealLineProps) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [at, at + 10], [0, 1], {
    easing: Easing.out(Easing.quad),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const x = interpolate(frame, [at, at + 10], [10, 0], {
    easing: Easing.out(Easing.quad),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        color,
        minHeight: 34,
        opacity,
        paddingLeft: indent,
        transform: `translateX(${x}px)`
      }}
    >
      {children}
    </div>
  );
};

type TypeLineProps = {
  readonly at: number;
  readonly color?: string;
  readonly frames?: number;
  readonly text: string;
};

export const TypeLine = ({
  at,
  color = "#f4f5f8",
  frames = 40,
  text
}: TypeLineProps) => {
  const frame = useCurrentFrame();
  const characters = Math.floor(
    interpolate(frame, [at, at + frames], [0, text.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    })
  );
  const cursorVisible = frame >= at && frame % 18 < 10;

  return (
    <div style={{ color, minHeight: 34 }}>
      {text.slice(0, characters)}
      {characters < text.length && cursorVisible ? "▋" : ""}
    </div>
  );
};
