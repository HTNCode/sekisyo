import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import OpenAI from "openai";

const MODEL = "gpt-4o-mini-tts-2025-12-15";
const VOICE = "marin";
const MINIMUM_AUDIO_BYTES = 4_096;

const scenes = [
  {
    name: "01-intro",
    text: "AIが書いたコードを拒まない。説明のないコードを拒む。Sekisyo CLIです。"
  },
  {
    name: "02-problem",
    text: "AIでコードを書く速度は上がりました。しかし、人が理解しレビューする速度は増えません。レビュー帯域が新しいボトルネックになります。"
  },
  {
    name: "03-concept",
    text: "Sekisyoは、コードを書いた側に説明してもらいます。作業者を育てた結果として、レビュー負担を減らします。"
  },
  {
    name: "04-analysis",
    text: "いつものギットプッシュで関所が開きます。Codexがコミット済みの差分とリポジトリ文脈を分析し、機械的変更、定型、必読へ分類。本当に読むべき箇所を絞ります。"
  },
  {
    name: "05-self-review",
    text: "まず、機械で見つけられる指摘を作業者が確認します。修正するか、意図的な変更なら、受け入れるリスクと理由を説明します。"
  },
  {
    name: "06-oral-exam",
    text: "次にGPTファイブポイントシックスが、境界条件、影響範囲、代替案、失敗時の挙動を質問します。たぶん大丈夫、という回答は通しません。関連する呼び出し元や設計判断を具体的に説明できるまで、焦点を絞った追撃質問を返します。"
  },
  {
    name: "07-pass",
    text: "説明が具体的になれば通過です。QアンドAをヘッドにひもづけて一時保存し、プッシュを続けます。"
  },
  {
    name: "08-pr-record",
    text: "Sekisyo PRは、注意力マップ、設計判断、リスク、検証内容、合格したQアンドAをプルリクエスト本文へ書き出します。レビュアーは必読箇所と判断材料へ集中できます。"
  },
  {
    name: "09-architecture",
    text: "Codexが読み、GPTファイブポイントシックスが問い、通行手形はGitの非公開領域へ保存。サーバーもデータベースも不要です。"
  },
  {
    name: "10-outro",
    text: "作業者には学びを。レビュアーには判断材料を。理解してから、レビューへ。Sekisyo CLI。"
  }
] as const;

const apiKey = process.env.OPENAI_API_KEY;
if (apiKey === undefined || apiKey.trim().length === 0) {
  throw new Error("OPENAI_API_KEY is required.");
}

const client = new OpenAI({
  apiKey,
  maxRetries: 2,
  timeout: 60_000
});
const outputDirectory = resolve(import.meta.dir, "../public/narration");
await mkdir(outputDirectory, { recursive: true });

const instructions = [
  "日本語で、落ち着きと自信のあるプロダクトデモのナレーションとして話してください。",
  "温かく明瞭な声で、技術用語を聞き取りやすく発音してください。",
  "速すぎず、簡潔で前向きなテンポにしてください。",
  "Sekisyoは「セキショ」、Codexは「コーデックス」と発音してください。",
  "入力文にない言葉を追加しないでください。"
].join(" ");

for (const scene of scenes) {
  const response = await client.audio.speech.create({
    input: scene.text,
    instructions,
    model: MODEL,
    response_format: "mp3",
    speed: 1.08,
    voice: VOICE
  });
  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.byteLength < MINIMUM_AUDIO_BYTES) {
    throw new Error(`OpenAI returned incomplete audio for ${scene.name}.`);
  }
  const targetPath = resolve(outputDirectory, `${scene.name}.mp3`);
  await writeFile(targetPath, audio);
  console.log(`${scene.name}: ${audio.byteLength} bytes`);
}
