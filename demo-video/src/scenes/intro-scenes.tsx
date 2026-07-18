import {
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

import { Chip, SceneShell } from "../components/scene-shell.tsx";
import { COLORS, FONT_MONO } from "../theme.ts";

type SceneProps = {
  readonly durationInFrames: number;
};

export const IntroScene = ({ durationInFrames }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrance = spring({
    config: { damping: 200 },
    durationInFrames: Math.round(0.8 * fps),
    fps,
    frame
  });

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow="OpenAI Build Week / Developer Tools"
      index="00"
      title="理解してから、レビューへ。"
    >
      <div
        style={{
          alignItems: "center",
          display: "grid",
          gap: 84,
          gridTemplateColumns: "500px 1fr",
          height: "100%"
        }}
      >
        <div
          style={{
            background: COLORS.panel,
            borderRadius: 48,
            boxShadow: "0 30px 100px rgba(23,25,31,0.15)",
            height: 470,
            overflow: "hidden",
            transform: `scale(${interpolate(entrance, [0, 1], [0.88, 1])})`,
            width: 470
          }}
        >
          <Img
            src={staticFile("sekisyo-cli-icon.jpg")}
            style={{
              height: "100%",
              objectFit: "cover",
              width: "100%"
            }}
          />
        </div>
        <div>
          <div
            style={{
              fontSize: 34,
              fontWeight: 850,
              lineHeight: 1.55,
              marginBottom: 38
            }}
          >
            私たちは、AIが書いたコードを拒まない。
            <br />
            <span style={{ color: COLORS.red }}>説明のないコードを拒む。</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <Chip tone="dark">pre-push gate</Chip>
            <Chip tone="blue">Codex CLI</Chip>
            <Chip tone="red">GPT-5.6</Chip>
            <Chip tone="green">worker-first</Chip>
          </div>
          <div
            style={{
              color: COLORS.muted,
              fontFamily: FONT_MONO,
              fontSize: 24,
              marginTop: 46
            }}
          >
            github.com/HTNCode/sekisyo
          </div>
          <div
            style={{
              color: COLORS.muted,
              fontSize: 18,
              fontWeight: 700,
              marginTop: 16
            }}
          >
            Narration is an AI-generated voice from the OpenAI Audio API.
          </div>
        </div>
      </div>
    </SceneShell>
  );
};

export const ProblemScene = ({ durationInFrames }: SceneProps) => {
  const frame = useCurrentFrame();
  const progress = Math.min(1, frame / Math.max(1, durationInFrames - 1));
  const codeHeight = interpolate(progress, [0.05, 0.78], [90, 390], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });
  const reviewHeight = interpolate(progress, [0.05, 0.78], [90, 130], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow="The bottleneck moved"
      index="01"
      title="コード生成は速くなった。理解の帯域は増えていない。"
    >
      <div
        style={{
          alignItems: "stretch",
          display: "grid",
          gap: 70,
          gridTemplateColumns: "1.05fr 0.95fr",
          height: "100%"
        }}
      >
        <div
          style={{
            alignItems: "flex-end",
            background: COLORS.panel,
            border: "1px solid rgba(23,25,31,0.08)",
            borderRadius: 30,
            display: "flex",
            gap: 44,
            justifyContent: "center",
            padding: "52px 70px 40px"
          }}
        >
          <Bar
            color={COLORS.blue}
            height={codeHeight}
            label="AI code output"
            value="5×"
          />
          <Bar
            color={COLORS.dark}
            height={reviewHeight}
            label="Reviewer attention"
            value="1×"
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            justifyContent: "center"
          }}
        >
          <Statement
            delay={0.18}
            progress={progress}
            text="作業者が理解しないまま、レビューへ送る"
          />
          <Statement
            delay={0.36}
            progress={progress}
            text="レビュアーが設計意図までdiffから推測する"
          />
          <Statement
            accent
            delay={0.54}
            progress={progress}
            text="「理解する責任」が下流へ移る"
          />
        </div>
      </div>
    </SceneShell>
  );
};

type BarProps = {
  readonly color: string;
  readonly height: number;
  readonly label: string;
  readonly value: string;
};

const Bar = ({ color, height, label, value }: BarProps) => (
  <div
    style={{
      alignItems: "center",
      display: "flex",
      flexDirection: "column",
      gap: 18,
      justifyContent: "flex-end",
      width: 230
    }}
  >
    <div style={{ color, fontSize: 38, fontWeight: 900 }}>{value}</div>
    <div
      style={{
        background: color,
        borderRadius: "24px 24px 6px 6px",
        height,
        width: 170
      }}
    />
    <div
      style={{
        fontSize: 22,
        fontWeight: 800,
        textAlign: "center"
      }}
    >
      {label}
    </div>
  </div>
);

type StatementProps = {
  readonly accent?: boolean;
  readonly delay: number;
  readonly progress: number;
  readonly text: string;
};

const Statement = ({
  accent = false,
  delay,
  progress,
  text
}: StatementProps) => {
  const opacity = interpolate(progress, [delay, delay + 0.12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        background: accent ? COLORS.redSoft : COLORS.panel,
        border: `2px solid ${accent ? COLORS.red : "rgba(23,25,31,0.09)"}`,
        borderRadius: 22,
        color: accent ? COLORS.red : COLORS.dark,
        fontSize: 27,
        fontWeight: 800,
        lineHeight: 1.45,
        opacity,
        padding: "26px 30px",
        transform: `translateX(${interpolate(opacity, [0, 1], [24, 0])}px)`
      }}
    >
      {text}
    </div>
  );
};

export const ConceptScene = ({ durationInFrames }: SceneProps) => {
  const frame = useCurrentFrame();
  const progress = Math.min(1, frame / Math.max(1, durationInFrames - 1));

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow="Move accountability upstream"
      index="02"
      title="レビュワーを試さない。書いた側に説明してもらう。"
    >
      <div
        style={{
          alignItems: "center",
          display: "grid",
          gridTemplateColumns: "1fr 140px 1fr 140px 1fr",
          height: "100%"
        }}
      >
        <RoleCard
          color={COLORS.blue}
          label="AUTHOR"
          note="AIと実装する"
          progress={progress}
          symbol="⌨"
        />
        <Arrow progress={progress} />
        <RoleCard
          color={COLORS.red}
          label="SEKISYO"
          note="問い、考え、説明する"
          progress={Math.max(0, progress - 0.15)}
          symbol="関"
        />
        <Arrow progress={Math.max(0, progress - 0.3)} />
        <RoleCard
          color={COLORS.green}
          label="REVIEWER"
          note="判断に集中する"
          progress={Math.max(0, progress - 0.45)}
          symbol="✓"
        />
      </div>
    </SceneShell>
  );
};

type RoleCardProps = {
  readonly color: string;
  readonly label: string;
  readonly note: string;
  readonly progress: number;
  readonly symbol: string;
};

const RoleCard = ({ color, label, note, progress, symbol }: RoleCardProps) => {
  const opacity = interpolate(progress, [0, 0.22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        alignItems: "center",
        background: COLORS.panel,
        border: `3px solid ${color}`,
        borderRadius: 32,
        boxShadow: "0 22px 60px rgba(23,25,31,0.1)",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        height: 360,
        justifyContent: "center",
        opacity,
        transform: `scale(${interpolate(opacity, [0, 1], [0.9, 1])})`
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: color,
          borderRadius: 24,
          color: COLORS.white,
          display: "flex",
          fontSize: 58,
          fontWeight: 900,
          height: 112,
          justifyContent: "center",
          width: 112
        }}
      >
        {symbol}
      </div>
      <div
        style={{
          color,
          fontFamily: FONT_MONO,
          fontSize: 25,
          fontWeight: 900,
          letterSpacing: "0.12em"
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{note}</div>
    </div>
  );
};

const Arrow = ({ progress }: { readonly progress: number }) => (
  <div
    style={{
      color: COLORS.dark,
      fontSize: 62,
      fontWeight: 900,
      opacity: interpolate(progress, [0, 0.2], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp"
      }),
      textAlign: "center"
    }}
  >
    →
  </div>
);
