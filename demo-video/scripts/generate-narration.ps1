param(
  [string]$VoiceName = "Microsoft Haruka Desktop"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Speech

$outputDirectory = Join-Path $PSScriptRoot "..\public\narration"
$waveDirectory = Join-Path $PSScriptRoot "..\work\narration-wav"
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $waveDirectory -Force | Out-Null

$scenes = @(
  @{
    Name = "01-intro"
    Text = "AIが書いたコードを拒まない。説明のないコードを拒む。Sekisyo CLIです。"
  },
  @{
    Name = "02-problem"
    Text = "AIでコードを書く速度は上がりました。しかし、人が理解しレビューする速度は増えません。レビュー帯域が新しいボトルネックになります。"
  },
  @{
    Name = "03-concept"
    Text = "Sekisyoは、コードを書いた側に説明してもらいます。作業者を育てた結果として、レビュー負担を減らします。"
  },
  @{
    Name = "04-analysis"
    Text = "いつものギットプッシュで関所が開きます。Codexがコミット済みの差分とリポジトリ文脈を分析し、機械的変更、定型、必読へ分類。本当に読むべき箇所を絞ります。"
  },
  @{
    Name = "05-self-review"
    Text = "まず、機械で見つけられる指摘を作業者が確認します。修正するか、意図的な変更なら、受け入れるリスクと理由を説明します。"
  },
  @{
    Name = "06-oral-exam"
    Text = "次にGPTファイブポイントシックスが、境界条件、影響範囲、代替案、失敗時の挙動を質問します。たぶん大丈夫、という回答は通しません。関連する呼び出し元や設計判断を具体的に説明できるまで、焦点を絞った追撃質問を返します。"
  },
  @{
    Name = "07-pass"
    Text = "説明が具体的になれば通過です。QアンドAをヘッドにひもづけて一時保存し、プッシュを続けます。"
  },
  @{
    Name = "08-pr-record"
    Text = "Sekisyo PRは、注意力マップ、設計判断、リスク、検証内容、合格したQアンドAをプルリクエスト本文へ書き出します。レビュアーは必読箇所と判断材料へ集中できます。"
  },
  @{
    Name = "09-architecture"
    Text = "Codexが読み、GPTファイブポイントシックスが問い、通行手形はGitの非公開領域へ保存。サーバーもデータベースも不要です。"
  },
  @{
    Name = "10-outro"
    Text = "作業者には学びを。レビュアーには判断材料を。理解してから、レビューへ。Sekisyo CLI。"
  }
)

$synthesizer = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synthesizer.SelectVoice($VoiceName)
$synthesizer.Rate = 1
$synthesizer.Volume = 100

try {
  foreach ($scene in $scenes) {
    $wavePath = Join-Path $waveDirectory "$($scene.Name).wav"
    $mp3Path = Join-Path $outputDirectory "$($scene.Name).mp3"

    $synthesizer.SetOutputToWaveFile($wavePath)
    $synthesizer.Speak($scene.Text)
    $synthesizer.SetOutputToNull()

    & ffmpeg -hide_banner -loglevel error -y -i $wavePath `
      -af "highpass=f=80,lowpass=f=12000,loudnorm=I=-16:TP=-1.5:LRA=7" `
      -codec:a libmp3lame -b:a 160k $mp3Path
    if ($LASTEXITCODE -ne 0) {
      throw "ffmpeg failed for $($scene.Name)."
    }

    & python -c "import os,sys; p=sys.argv[1]; os.remove(p) if os.path.exists(p) else None; print('DELETED OK' if not os.path.exists(p) else 'STILL EXISTS')" $wavePath
    if ($LASTEXITCODE -ne 0) {
      throw "Temporary WAV cleanup failed for $($scene.Name)."
    }
  }
}
finally {
  $synthesizer.Dispose()
}

& python -c "import os,sys; p=sys.argv[1]; os.rmdir(p) if os.path.isdir(p) and not os.listdir(p) else None; print('CLEANED' if not os.path.exists(p) else 'NOT EMPTY')" $waveDirectory
