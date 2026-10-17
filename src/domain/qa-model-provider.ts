export const QA_MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "openai-compatible"
] as const;

export type QaModelProvider = (typeof QA_MODEL_PROVIDERS)[number];

export const DEFAULT_QA_MODEL_PROVIDER: QaModelProvider = "openai";

/**
 * provider だけを指定して model を省いたときの既定値。model の既定値は OpenAI の
 * モデル名なので、他社へそのまま送らないよう提供元ごとに解決する。google と
 * openai-compatible は提供されるモデルが利用者の契約や接続先で変わるため既定を
 * 持たず、明示を求める。
 */
export const DEFAULT_MODEL_BY_PROVIDER: Readonly<
  Partial<Record<QaModelProvider, string>>
> = {
  anthropic: "claude-opus-5-5"
};
