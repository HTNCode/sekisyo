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

export const PrRecordScene = ({ durationInFrames }: SceneProps) => {
  const frame = useCurrentFrame();
  const progress = Math.min(1, frame / Math.max(1, durationInFrames - 1));

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow="sekisyo pr / Review handoff"
      index="07"
      title="レビュアーには、判断に必要な情報だけを届ける。"
    >
      <div
        style={{
          display: "grid",
          gap: 44,
          gridTemplateColumns: "1.25fr 0.75fr",
          height: "100%"
        }}
      >
        <div
          style={{
            background: COLORS.panel,
            border: "1px solid rgba(23,25,31,0.12)",
            borderRadius: 26,
            boxShadow: "0 26px 80px rgba(23,25,31,0.13)",
            overflow: "hidden"
          }}
        >
          <div
            style={{
              alignItems: "center",
              borderBottom: "1px solid rgba(23,25,31,0.1)",
              display: "flex",
              fontSize: 22,
              fontWeight: 800,
              height: 62,
              justifyContent: "space-between",
              padding: "0 28px"
            }}
          >
            <span>Pull request #42</span>
            <span style={{ color: COLORS.green }}>Open</span>
          </div>
          <div style={{ padding: "28px 34px" }}>
            <div
              style={{
                color: COLORS.red,
                fontFamily: FONT_MONO,
                fontSize: 22,
                fontWeight: 900,
                marginBottom: 20
              }}
            >
              SEKISYO ACCOUNTABILITY RECORD
            </div>
            <RecordRow
              delay={0.08}
              progress={progress}
              title="対象HEAD"
              value="8ca71f2"
            />
            <RecordRow
              delay={0.18}
              progress={progress}
              title="必読"
              value="42 / 1,000 lines"
            />
            <RecordRow
              delay={0.28}
              progress={progress}
              title="設計判断"
              value="version再確認でstale writeを防止"
            />
            <RecordRow
              delay={0.38}
              progress={progress}
              title="認識済みリスク"
              value="旧経路は短いTTLで再検証"
            />
            <RecordRow
              delay={0.48}
              progress={progress}
              title="検証"
              value="競合テスト・timeoutテスト"
            />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 22,
            justifyContent: "center"
          }}
        >
          <StatCard
            color={COLORS.red}
            label="must-read"
            progress={progress}
            value="42 lines"
          />
          <StatCard
            color={COLORS.blue}
            label="review context"
            progress={Math.max(0, progress - 0.14)}
            value="Q&A + risks"
          />
          <StatCard
            color={COLORS.green}
            label="local pass"
            progress={Math.max(0, progress - 0.28)}
            value="deleted"
          />
        </div>
      </div>
    </SceneShell>
  );
};

type RecordRowProps = {
  readonly delay: number;
  readonly progress: number;
  readonly title: string;
  readonly value: string;
};

const RecordRow = ({ delay, progress, title, value }: RecordRowProps) => {
  const opacity = interpolate(progress, [delay, delay + 0.12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        borderTop: "1px solid rgba(23,25,31,0.09)",
        display: "grid",
        fontSize: 24,
        gridTemplateColumns: "190px 1fr",
        lineHeight: 1.35,
        opacity,
        padding: "18px 0"
      }}
    >
      <span style={{ color: COLORS.muted, fontWeight: 750 }}>{title}</span>
      <span style={{ fontWeight: 850 }}>{value}</span>
    </div>
  );
};

type StatCardProps = {
  readonly color: string;
  readonly label: string;
  readonly progress: number;
  readonly value: string;
};

const StatCard = ({ color, label, progress, value }: StatCardProps) => {
  const opacity = interpolate(progress, [0, 0.18], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        background: COLORS.panel,
        borderLeft: `8px solid ${color}`,
        borderRadius: 18,
        boxShadow: "0 16px 40px rgba(23,25,31,0.08)",
        opacity,
        padding: "24px 28px",
        transform: `translateX(${interpolate(opacity, [0, 1], [28, 0])}px)`
      }}
    >
      <div
        style={{
          color: COLORS.muted,
          fontFamily: FONT_MONO,
          fontSize: 18,
          fontWeight: 800,
          marginBottom: 8
        }}
      >
        {label}
      </div>
      <div style={{ color, fontSize: 34, fontWeight: 900 }}>{value}</div>
    </div>
  );
};

export const ArchitectureScene = ({ durationInFrames }: SceneProps) => {
  const frame = useCurrentFrame();
  const progress = Math.min(1, frame / Math.max(1, durationInFrames - 1));

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow="Architecture"
      index="08"
      title="Codexで読み、GPT-5.6で問い、ローカルに残す。"
    >
      <div
        style={{
          display: "grid",
          gap: 34,
          gridTemplateColumns: "repeat(3, 1fr)",
          height: "100%"
        }}
      >
        <ArchitectureCard
          color={COLORS.blue}
          delay={0.05}
          label="Codex CLI"
          progress={progress}
          role="差分・影響範囲・注意力マップ"
          symbol="C"
        />
        <ArchitectureCard
          color={COLORS.red}
          delay={0.2}
          label="GPT-5.6"
          progress={progress}
          role="質問・具体性判定・追撃・要約"
          symbol="5.6"
        />
        <ArchitectureCard
          color={COLORS.green}
          delay={0.35}
          label=".git/sekisyo/"
          progress={progress}
          role="HEADに紐づく使い捨て通行手形"
          symbol="✓"
        />
      </div>
    </SceneShell>
  );
};

type ArchitectureCardProps = {
  readonly color: string;
  readonly delay: number;
  readonly label: string;
  readonly progress: number;
  readonly role: string;
  readonly symbol: string;
};

const ArchitectureCard = ({
  color,
  delay,
  label,
  progress,
  role,
  symbol
}: ArchitectureCardProps) => {
  const opacity = interpolate(progress, [delay, delay + 0.17], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div
      style={{
        alignItems: "center",
        background: COLORS.panel,
        border: "1px solid rgba(23,25,31,0.1)",
        borderRadius: 30,
        boxShadow: "0 24px 70px rgba(23,25,31,0.09)",
        display: "flex",
        flexDirection: "column",
        gap: 24,
        justifyContent: "center",
        opacity,
        padding: 44,
        textAlign: "center",
        transform: `translateY(${interpolate(opacity, [0, 1], [30, 0])}px)`
      }}
    >
      <div
        style={{
          alignItems: "center",
          background: color,
          borderRadius: 24,
          color: COLORS.white,
          display: "flex",
          fontFamily: FONT_MONO,
          fontSize: symbol.length > 1 ? 38 : 62,
          fontWeight: 900,
          height: 118,
          justifyContent: "center",
          width: 118
        }}
      >
        {symbol}
      </div>
      <div style={{ color, fontSize: 31, fontWeight: 900 }}>{label}</div>
      <div
        style={{
          color: COLORS.muted,
          fontSize: 24,
          fontWeight: 750,
          lineHeight: 1.5
        }}
      >
        {role}
      </div>
    </div>
  );
};

export const OutroScene = ({ durationInFrames }: SceneProps) => {
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
      eyebrow="Sekisyo CLI"
      index="09"
      title="作業者には学びを。レビュアーには判断材料を。"
    >
      <div
        style={{
          alignItems: "center",
          display: "grid",
          gap: 74,
          gridTemplateColumns: "390px 1fr",
          height: "100%"
        }}
      >
        <Img
          src={staticFile("sekisyo-cli-icon.jpg")}
          style={{
            borderRadius: 38,
            boxShadow: "0 26px 80px rgba(23,25,31,0.15)",
            height: 360,
            objectFit: "cover",
            transform: `scale(${interpolate(entrance, [0, 1], [0.9, 1])})`,
            width: 360
          }}
        />
        <div>
          <div
            style={{
              fontSize: 38,
              fontWeight: 900,
              lineHeight: 1.5,
              marginBottom: 32
            }}
          >
            Stronger authors
            <span style={{ color: COLORS.red }}> → </span>
            Lower reviewer load
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            <Chip tone="blue">TypeScript + Bun</Chip>
            <Chip tone="dark">Git pre-push</Chip>
            <Chip tone="red">OpenAI</Chip>
          </div>
          <div
            style={{
              color: COLORS.dark,
              fontFamily: FONT_MONO,
              fontSize: 28,
              fontWeight: 800,
              marginTop: 44
            }}
          >
            github.com/HTNCode/sekisyo
          </div>
        </div>
      </div>
    </SceneShell>
  );
};

export const Poster = () => (
  <div
    style={{
      alignItems: "center",
      background: COLORS.cream,
      color: COLORS.dark,
      display: "grid",
      fontFamily: '"Yu Gothic UI", Arial, sans-serif',
      gap: 64,
      gridTemplateColumns: "440px 1fr",
      height: "100%",
      padding: "100px 120px",
      width: "100%"
    }}
  >
    <Img
      src={staticFile("sekisyo-cli-icon.jpg")}
      style={{
        borderRadius: 44,
        boxShadow: "0 28px 90px rgba(23,25,31,0.16)",
        height: 420,
        objectFit: "cover",
        width: 420
      }}
    />
    <div>
      <div
        style={{
          color: COLORS.red,
          fontFamily: FONT_MONO,
          fontSize: 24,
          fontWeight: 900,
          letterSpacing: "0.12em",
          marginBottom: 22
        }}
      >
        SEKISYO CLI / DEMO
      </div>
      <div
        style={{
          fontSize: 82,
          fontWeight: 900,
          letterSpacing: "-0.05em",
          lineHeight: 1.08
        }}
      >
        理解してから、
        <br />
        レビューへ。
      </div>
      <div
        style={{
          color: COLORS.muted,
          fontSize: 31,
          fontWeight: 750,
          lineHeight: 1.5,
          marginTop: 30
        }}
      >
        AI-generated code, delivered with accountability.
      </div>
    </div>
  </div>
);
