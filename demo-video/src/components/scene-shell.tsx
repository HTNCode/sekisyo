import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";

import { COLORS, FONT_SANS } from "../theme.ts";

type SceneShellProps = {
  readonly children: ReactNode;
  readonly durationInFrames: number;
  readonly eyebrow: string;
  readonly index: string;
  readonly title: string;
};

export const SceneShell = ({
  children,
  durationInFrames,
  eyebrow,
  index,
  title
}: SceneShellProps) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    frame,
    [0, 12, durationInFrames - 12, durationInFrames],
    [0, 1, 1, 0],
    {
      easing: Easing.inOut(Easing.quad),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    }
  );
  const translateY = interpolate(frame, [0, 20], [24, 0], {
    easing: Easing.out(Easing.quad),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.cream,
        color: COLORS.dark,
        fontFamily: FONT_SANS,
        opacity,
        overflow: "hidden"
      }}
    >
      <AbsoluteFill
        style={{
          backgroundImage:
            "linear-gradient(rgba(23,25,31,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(23,25,31,0.035) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage:
            "linear-gradient(to bottom, rgba(0,0,0,0.4), transparent 92%)"
        }}
      />
      <div
        style={{
          alignItems: "center",
          display: "flex",
          justifyContent: "space-between",
          left: 92,
          position: "absolute",
          right: 92,
          top: 56
        }}
      >
        <div
          style={{
            color: COLORS.muted,
            fontSize: 21,
            fontWeight: 700,
            letterSpacing: "0.16em"
          }}
        >
          SEKISYO / WORKER-FIRST ACCOUNTABILITY
        </div>
        <div
          style={{
            border: `2px solid ${COLORS.dark}`,
            borderRadius: 999,
            fontSize: 20,
            fontWeight: 800,
            padding: "9px 17px"
          }}
        >
          {index}
        </div>
      </div>
      <div
        style={{
          left: 92,
          position: "absolute",
          right: 92,
          top: 130,
          transform: `translateY(${translateY}px)`
        }}
      >
        <div
          style={{
            color: COLORS.red,
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "0.11em",
            marginBottom: 14,
            textTransform: "uppercase"
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{
            fontSize: 58,
            fontWeight: 900,
            letterSpacing: "-0.035em",
            lineHeight: 1.08
          }}
        >
          {title}
        </div>
      </div>
      <div
        style={{
          bottom: 130,
          left: 92,
          position: "absolute",
          right: 92,
          top: 290
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );
};

type ChipProps = {
  readonly children: ReactNode;
  readonly tone?: "blue" | "dark" | "green" | "red";
};

export const Chip = ({ children, tone = "dark" }: ChipProps) => {
  const styles = {
    blue: { background: COLORS.blueSoft, color: COLORS.blue },
    dark: { background: COLORS.dark, color: COLORS.white },
    green: { background: COLORS.greenSoft, color: COLORS.green },
    red: { background: COLORS.redSoft, color: COLORS.red }
  } as const;

  return (
    <span
      style={{
        ...styles[tone],
        borderRadius: 999,
        display: "inline-flex",
        fontSize: 22,
        fontWeight: 800,
        padding: "12px 20px"
      }}
    >
      {children}
    </span>
  );
};
