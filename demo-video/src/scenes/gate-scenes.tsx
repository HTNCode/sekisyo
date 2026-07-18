import {
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

import { Chip, SceneShell } from "../components/scene-shell.tsx";
import { RevealLine, Terminal, TypeLine } from "../components/terminal.tsx";
import { COLORS, FONT_MONO } from "../theme.ts";

type SceneProps = {
  readonly durationInFrames: number;
};

function frameAt(progress: number, durationInFrames: number): number {
  return Math.round(progress * durationInFrames);
}

export const AnalysisScene = ({ durationInFrames }: SceneProps) => {
  const at = (progress: number) => frameAt(progress, durationInFrames);

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow="Axis A + C / Repository-aware analysis"
      index="03"
      title="いつもの git push で、関所が開く。"
    >
      <div
        style={{
          display: "grid",
          gap: 46,
          gridTemplateColumns: "1.35fr 0.65fr",
          height: "100%"
        }}
      >
        <Terminal>
          <TypeLine at={at(0.04)} frames={at(0.08)} text="$ git push" />
          <RevealLine at={at(0.16)} color="#aeb3bd">
            sekisyo: main との差分を分析中... (codex exec)
          </RevealLine>
          <RevealLine at={at(0.32)} color={COLORS.blue}>
            ── 注意力マップ ─────────────────────
          </RevealLine>
          <RevealLine at={at(0.42)}>機械的変更 814行</RevealLine>
          <RevealLine at={at(0.49)}>定型 144行</RevealLine>
          <RevealLine at={at(0.56)} color="#ff7676">
            必読 42行
          </RevealLine>
          <RevealLine at={at(0.7)} color="#aeb3bd">
            リポジトリ文脈から影響範囲を確認しました
          </RevealLine>
        </Terminal>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            justifyContent: "center"
          }}
        >
          <AttentionMeter
            at={at(0.35)}
            color="#b7bcc5"
            label="mechanical"
            value={814}
          />
          <AttentionMeter
            at={at(0.45)}
            color={COLORS.blue}
            label="routine"
            value={144}
          />
          <AttentionMeter
            at={at(0.55)}
            color={COLORS.red}
            label="must-read"
            value={42}
          />
          <div style={{ marginTop: 16 }}>
            <Chip tone="red">1000 lines → focus on 42</Chip>
          </div>
        </div>
      </div>
    </SceneShell>
  );
};

type AttentionMeterProps = {
  readonly at: number;
  readonly color: string;
  readonly label: string;
  readonly value: number;
};

const AttentionMeter = ({ at, color, label, value }: AttentionMeterProps) => {
  const frame = useCurrentFrame();
  const width = interpolate(frame, [at, at + 26], [0, 100], {
    easing: Easing.out(Easing.quad),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp"
  });

  return (
    <div>
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 10
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 20,
            fontWeight: 800
          }}
        >
          {label}
        </span>
        <span style={{ color, fontSize: 31, fontWeight: 900 }}>{value}</span>
      </div>
      <div
        style={{
          background: "rgba(23,25,31,0.08)",
          borderRadius: 999,
          height: 18,
          overflow: "hidden"
        }}
      >
        <div
          style={{
            background: color,
            borderRadius: 999,
            height: "100%",
            width: `${width}%`
          }}
        />
      </div>
    </div>
  );
};

export const SelfReviewScene = ({ durationInFrames }: SceneProps) => {
  const at = (progress: number) => frameAt(progress, durationInFrames);

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow="Axis B / Initial self-review"
      index="04"
      title="機械で潰せる指摘は、作業者が先に引き受ける。"
    >
      <Terminal label="sekisyo — self review">
        <RevealLine at={at(0.04)} color={COLORS.red}>
          ── 一次セルフレビュー 1件 ─────────────
        </RevealLine>
        <RevealLine at={at(0.15)}>[1] src/cache/invalidate.ts:31</RevealLine>
        <RevealLine at={at(0.23)} color="#ffd27a" indent={36}>
          TTL切れとの競合時に古い値が書き戻る可能性
        </RevealLine>
        <RevealLine at={at(0.39)} color="#aeb3bd">
          → (f) 修正するため中断 / (i) 意図的・理由を説明
        </RevealLine>
        <TypeLine
          at={at(0.53)}
          color={COLORS.blue}
          frames={at(0.25)}
          text="> i  stale-while-revalidateを優先し、書き戻し前にversionを再確認します"
        />
        <RevealLine at={at(0.84)} color="#69d9a0">
          ✓ 設計理由を通行手形へ記録しました
        </RevealLine>
      </Terminal>
    </SceneShell>
  );
};

export const OralExamScene = ({ durationInFrames }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const at = (progress: number) => frameAt(progress, durationInFrames);
  const warningScale = spring({
    config: { damping: 16, stiffness: 170 },
    fps,
    frame: frame - at(0.34),
    durationInFrames: Math.round(0.5 * fps)
  });

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow="Oral examination / GPT-5.6"
      index="05"
      title="要約ではなく、理解していないと答えられない問いを。"
    >
      <Terminal label="sekisyo — oral examination">
        <RevealLine at={at(0.03)} color={COLORS.blue}>
          ── 口頭試問 3問 ──────────────────────
        </RevealLine>
        <RevealLine at={at(0.1)}>
          Q1. invalidateを呼ばなくなった旧経路のキャッシュは、
        </RevealLine>
        <RevealLine at={at(0.14)} indent={48}>
          誰が、いつ無効化しますか？
        </RevealLine>
        <TypeLine
          at={at(0.23)}
          color="#ffd27a"
          frames={at(0.08)}
          text="> たぶん問題ありません"
        />
        <div
          style={{
            opacity: warningScale,
            transform: `scale(${interpolate(warningScale, [0, 1], [0.97, 1])})`
          }}
        >
          <RevealLine at={at(0.34)} color="#ff7676">
            その回答では影響範囲を確認できません。
          </RevealLine>
          <RevealLine at={at(0.39)} color="#ff9a9a">
            関連する呼び出し元と無効化のタイミングを説明してください。
          </RevealLine>
        </div>
        <TypeLine
          at={at(0.52)}
          color="#c7ecff"
          frames={at(0.27)}
          text="> src/legacy/sync.ts は更新後も旧invalidateを呼びます。失敗時はTTLを短縮し、次のreadで再検証します。"
        />
        <RevealLine at={at(0.84)} color="#69d9a0">
          ✓ 具体的で検証可能な説明です
        </RevealLine>
      </Terminal>
    </SceneShell>
  );
};

export const PassScene = ({ durationInFrames }: SceneProps) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const check = spring({
    config: { damping: 16, stiffness: 150 },
    durationInFrames: Math.round(0.8 * fps),
    fps,
    frame
  });

  return (
    <SceneShell
      durationInFrames={durationInFrames}
      eyebrow="Clearance"
      index="06"
      title="説明できたら、pushを続ける。"
    >
      <div
        style={{
          alignItems: "center",
          display: "grid",
          gap: 70,
          gridTemplateColumns: "0.7fr 1.3fr",
          height: "100%"
        }}
      >
        <div
          style={{
            alignItems: "center",
            background: COLORS.green,
            borderRadius: "50%",
            color: COLORS.white,
            display: "flex",
            fontSize: 170,
            fontWeight: 900,
            height: 310,
            justifyContent: "center",
            transform: `scale(${check})`,
            width: 310
          }}
        >
          ✓
        </div>
        <Terminal label="sekisyo — passed">
          <RevealLine at={12} color="#69d9a0">
            ── 通過 ─────────────────────────────
          </RevealLine>
          <RevealLine at={30}>設計判断の記録を一時保存しました</RevealLine>
          <RevealLine at={48} color="#aeb3bd" indent={36}>
            .git/sekisyo/ · bound to HEAD SHA
          </RevealLine>
          <RevealLine at={72} color={COLORS.blue}>
            push を続行します...
          </RevealLine>
          <RevealLine at={102} color="#69d9a0">
            ✓ remote updated
          </RevealLine>
        </Terminal>
      </div>
    </SceneShell>
  );
};
