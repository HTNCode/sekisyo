const CANNED_REASON_PATTERN =
  /^(?:(?:特に)?問題(?:は)?(?:ない|無い|なし|無し|ありません|ございません)(?:です)?(?:と思います)?|大丈夫(?:です|だ)?(?:と思います)?|仕様(?:どおり|通り)(?:です|だ)?(?:と思います)?|想定(?:どおり|通り)(?:です|だ)?(?:と思います)?|意図的(?:な変更)?(?:です)?|対応不要(?:です)?|影響(?:は)?(?:ない|無い|ありません)(?:です)?|許容範囲(?:です)?|リスク(?:は)?(?:許容|受け入れ)(?:します|です)?)+$/u;

const RELATION_OR_CONDITION_PATTERN =
  /ため|ので|から|なら|場合|とき|時|のみ|上限|下限|最大|最小|以上|以下|未満|互換|要件|制約|前提|条件|境界|により|によって|に対して|として|呼び出し(?:元|側)で/iu;

const TARGET_OR_MECHANISM_PATTERN =
  /入力|出力|呼び出し(?:元|側)|api|db|http|キャッシュ|ロック|キュー|リクエスト|レスポンス|ユーザー|利用者|クライアント|サーバー|データベース|ファイル|セッション|トランザクション|スレッド|プロセス|メモリ|cpu|ネットワーク|テーブル|カラム|関数|メソッド|クラス|モジュール|エンドポイント|直列化|排他|\d+(?:件|秒|分|時間|回|個|行|バイト|kb|mb|gb|ms)|(?:src|test|tests|app|lib|packages?)[\\/][^\s]+|[a-z0-9_.-]+\.(?:ts|tsx|js|jsx|json|yml|yaml|md)(?::l?\d+)?/iu;

const IMPACT_HANDLING_OR_VERIFICATION_PATTERN =
  /リスク|影響|危険|競合|失敗|障害|例外|不整合|欠損|破損|漏洩|遅延|停止|重複|枯渇|超過|誤動作|取りこぼ|タイムアウト|デッドロック|エラー|受け入れ|許容|回避|防(?:ぐ|止)|軽減|抑制|限定|制限|監視|検知|通知|復旧|再試行|リトライ|ロールバック|中断|拒否|return|書き込まない|書き込みをしない|書き込みません|読み込まない|更新しない|削除しない|送信しない|保存しない|フォールバック|ログ|テスト|検証|担保|隔離|無効化|返す/iu;

const GENERIC_REASON_TERMS_PATTERN =
  /仕様|要件|制約|前提|契約|条件|リスク|危険|影響|問題|意図的|変更|挙動|理由|扱い|対応|方針|確認済み|許容|受け入れ|回避|軽減|監視|検知|復旧|防止|問題ない|大丈夫|ありません|ございません|しています|します|です|ます|する|あり|なし|ない|ため|ので/giu;

const VAGUE_QUALIFIER_PATTERN = /とりあえず|なんとなく|(?:この|その)まま進め/iu;

const MIN_INFORMATIVE_CHARACTERS = 10;

export type ReviewReasonValidation =
  | {
      readonly valid: true;
      readonly value: string;
    }
  | {
      readonly message: string;
      readonly valid: false;
    };

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function compact(value: string): string {
  return normalize(value).replace(/[\s\p{C}\p{P}\p{S}]/gu, "");
}

function isCannedReason(value: string): boolean {
  const withoutConnectors = compact(value).replace(
    /(?:なので|ですので|ので|から|また|かつ|および|そして)/gu,
    ""
  );
  return CANNED_REASON_PATTERN.test(withoutConnectors);
}

function informativeCharacterCount(value: string): number {
  const remainder = compact(value)
    .replace(GENERIC_REASON_TERMS_PATTERN, "")
    .replace(/[はがをにでとのもへや]/gu, "");
  return [...remainder].length;
}

function missingViewpointMessage(
  specificationMissing: boolean,
  riskHandlingMissing: boolean
): string {
  if (specificationMissing && riskHandlingMissing) {
    return (
      "仕様・制約とリスクの扱いが不足しています。" +
      "対象条件や前提と、想定リスクをどう回避・軽減・許容するかを具体的に入力してください。"
    );
  }
  if (specificationMissing) {
    return (
      "仕様・制約の具体化が不足しています。" +
      "対象条件、上限、呼び出し側の前提などを入力してください。"
    );
  }
  return (
    "リスクの扱いが不足しています。" +
    "想定リスクと、回避・軽減・監視・許容の方針を入力してください。"
  );
}

export function validateReviewReason(reason: string): ReviewReasonValidation {
  const value = reason.trim();
  const normalized = normalize(value);
  if (value.length === 0 || isCannedReason(value)) {
    return {
      message:
        "定型的な回答では記録できません。" +
        "具体的な仕様・制約と、リスクをどう扱うかを入力してください。",
      valid: false
    };
  }
  if (VAGUE_QUALIFIER_PATTERN.test(normalized)) {
    return {
      message: missingViewpointMessage(true, true),
      valid: false
    };
  }

  const informativeCharacters = informativeCharacterCount(value);
  const includesRelationOrCondition =
    RELATION_OR_CONDITION_PATTERN.test(normalized);
  const includesTargetOrMechanism =
    TARGET_OR_MECHANISM_PATTERN.test(normalized);
  const includesImpactHandlingOrVerification =
    IMPACT_HANDLING_OR_VERIFICATION_PATTERN.test(normalized);
  if (
    informativeCharacters >= MIN_INFORMATIVE_CHARACTERS &&
    includesRelationOrCondition &&
    includesTargetOrMechanism &&
    includesImpactHandlingOrVerification
  ) {
    return { valid: true, value };
  }

  let specificationMissing =
    !includesRelationOrCondition || !includesTargetOrMechanism;
  let riskViewpointMissing =
    !includesTargetOrMechanism || !includesImpactHandlingOrVerification;
  if (!specificationMissing && !riskViewpointMissing) {
    specificationMissing = true;
    riskViewpointMissing = true;
  }

  return {
    message: missingViewpointMessage(
      specificationMissing,
      riskViewpointMissing
    ),
    valid: false
  };
}
