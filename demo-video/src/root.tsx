import type { ReactNode } from "react";
import { Audio } from "@remotion/media";
import { AbsoluteFill, Composition, Series, Still, staticFile } from "remotion";

import { CaptionTrack } from "./components/caption-track.tsx";
import {
  AnalysisScene,
  OralExamScene,
  PassScene,
  SelfReviewScene
} from "./scenes/gate-scenes.tsx";
import {
  ConceptScene,
  IntroScene,
  ProblemScene
} from "./scenes/intro-scenes.tsx";
import {
  ArchitectureScene,
  OutroScene,
  Poster,
  PrRecordScene
} from "./scenes/outcome-scenes.tsx";
import { FPS, HEIGHT, WIDTH } from "./theme.ts";

const DURATIONS = {
  analysis: 15 * FPS,
  architecture: 11 * FPS,
  concept: 9 * FPS,
  intro: 8 * FPS,
  oralExam: 20 * FPS,
  outro: 10 * FPS,
  pass: 9 * FPS,
  prRecord: 18 * FPS,
  problem: 12 * FPS,
  selfReview: 11 * FPS
} as const;

const FULL_DURATION = Object.values(DURATIONS).reduce(
  (total, duration) => total + duration,
  0
);

type NarratedSceneProps = {
  readonly audio: string;
  readonly children: ReactNode;
};

const NarratedScene = ({ audio, children }: NarratedSceneProps) => (
  <AbsoluteFill>
    {children}
    <Audio src={staticFile(`narration/${audio}.mp3`)} volume={0.95} />
  </AbsoluteFill>
);

export const SekisyoDemo = () => (
  <AbsoluteFill>
    <Series>
      <Series.Sequence durationInFrames={DURATIONS.intro} premountFor={FPS}>
        <NarratedScene audio="01-intro">
          <IntroScene durationInFrames={DURATIONS.intro} />
        </NarratedScene>
      </Series.Sequence>
      <Series.Sequence durationInFrames={DURATIONS.problem} premountFor={FPS}>
        <NarratedScene audio="02-problem">
          <ProblemScene durationInFrames={DURATIONS.problem} />
        </NarratedScene>
      </Series.Sequence>
      <Series.Sequence durationInFrames={DURATIONS.concept} premountFor={FPS}>
        <NarratedScene audio="03-concept">
          <ConceptScene durationInFrames={DURATIONS.concept} />
        </NarratedScene>
      </Series.Sequence>
      <Series.Sequence durationInFrames={DURATIONS.analysis} premountFor={FPS}>
        <NarratedScene audio="04-analysis">
          <AnalysisScene durationInFrames={DURATIONS.analysis} />
        </NarratedScene>
      </Series.Sequence>
      <Series.Sequence
        durationInFrames={DURATIONS.selfReview}
        premountFor={FPS}
      >
        <NarratedScene audio="05-self-review">
          <SelfReviewScene durationInFrames={DURATIONS.selfReview} />
        </NarratedScene>
      </Series.Sequence>
      <Series.Sequence durationInFrames={DURATIONS.oralExam} premountFor={FPS}>
        <NarratedScene audio="06-oral-exam">
          <OralExamScene durationInFrames={DURATIONS.oralExam} />
        </NarratedScene>
      </Series.Sequence>
      <Series.Sequence durationInFrames={DURATIONS.pass} premountFor={FPS}>
        <NarratedScene audio="07-pass">
          <PassScene durationInFrames={DURATIONS.pass} />
        </NarratedScene>
      </Series.Sequence>
      <Series.Sequence durationInFrames={DURATIONS.prRecord} premountFor={FPS}>
        <NarratedScene audio="08-pr-record">
          <PrRecordScene durationInFrames={DURATIONS.prRecord} />
        </NarratedScene>
      </Series.Sequence>
      <Series.Sequence
        durationInFrames={DURATIONS.architecture}
        premountFor={FPS}
      >
        <NarratedScene audio="09-architecture">
          <ArchitectureScene durationInFrames={DURATIONS.architecture} />
        </NarratedScene>
      </Series.Sequence>
      <Series.Sequence durationInFrames={DURATIONS.outro} premountFor={FPS}>
        <NarratedScene audio="10-outro">
          <OutroScene durationInFrames={DURATIONS.outro} />
        </NarratedScene>
      </Series.Sequence>
    </Series>
    <CaptionTrack />
  </AbsoluteFill>
);

const PREVIEW_DURATIONS = {
  analysis: 6 * FPS,
  intro: 4 * FPS,
  oral: 8 * FPS,
  outro: 3 * FPS,
  pr: 5 * FPS,
  self: 4 * FPS
} as const;

const PREVIEW_DURATION = Object.values(PREVIEW_DURATIONS).reduce(
  (total, duration) => total + duration,
  0
);

export const SekisyoPreview = () => (
  <AbsoluteFill>
    <Series>
      <Series.Sequence
        durationInFrames={PREVIEW_DURATIONS.intro}
        premountFor={FPS}
      >
        <IntroScene durationInFrames={PREVIEW_DURATIONS.intro} />
      </Series.Sequence>
      <Series.Sequence
        durationInFrames={PREVIEW_DURATIONS.analysis}
        premountFor={FPS}
      >
        <AnalysisScene durationInFrames={PREVIEW_DURATIONS.analysis} />
      </Series.Sequence>
      <Series.Sequence
        durationInFrames={PREVIEW_DURATIONS.self}
        premountFor={FPS}
      >
        <SelfReviewScene durationInFrames={PREVIEW_DURATIONS.self} />
      </Series.Sequence>
      <Series.Sequence
        durationInFrames={PREVIEW_DURATIONS.oral}
        premountFor={FPS}
      >
        <OralExamScene durationInFrames={PREVIEW_DURATIONS.oral} />
      </Series.Sequence>
      <Series.Sequence
        durationInFrames={PREVIEW_DURATIONS.pr}
        premountFor={FPS}
      >
        <PrRecordScene durationInFrames={PREVIEW_DURATIONS.pr} />
      </Series.Sequence>
      <Series.Sequence
        durationInFrames={PREVIEW_DURATIONS.outro}
        premountFor={FPS}
      >
        <OutroScene durationInFrames={PREVIEW_DURATIONS.outro} />
      </Series.Sequence>
    </Series>
  </AbsoluteFill>
);

export const RemotionRoot = () => (
  <>
    <Composition
      component={SekisyoDemo}
      durationInFrames={FULL_DURATION}
      fps={FPS}
      height={HEIGHT}
      id="SekisyoDemo"
      width={WIDTH}
    />
    <Composition
      component={SekisyoPreview}
      durationInFrames={PREVIEW_DURATION}
      fps={FPS}
      height={HEIGHT}
      id="SekisyoPreview"
      width={WIDTH}
    />
    <Still
      component={Poster}
      height={HEIGHT}
      id="SekisyoPoster"
      width={WIDTH}
    />
  </>
);
