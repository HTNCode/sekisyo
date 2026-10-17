import {
  DEFAULT_QA_MODEL_PROVIDER,
  QA_MODEL_PROVIDERS,
  type QaModelProvider
} from "../domain/qa-model-provider.ts";
import type { SekisyoConfig } from "./schema.ts";

export interface QaModelSelection {
  readonly provider: QaModelProvider;
  readonly model: string;
}

export function selectQaModel(
  config: Pick<SekisyoConfig, "model" | "provider">
): QaModelSelection {
  return {
    provider: config.provider ?? DEFAULT_QA_MODEL_PROVIDER,
    model: config.model
  };
}

/**
 * 通過記録に保存し、設定との一致判定に使う識別子。OpenAI は従来どおりモデル名
 * だけにして、既存の通過記録を無効化しない。
 */
export function qaModelDescriptor(selection: QaModelSelection): string {
  return selection.provider === DEFAULT_QA_MODEL_PROVIDER
    ? selection.model
    : `${selection.provider}:${selection.model}`;
}

/**
 * qaModelDescriptor の逆変換。Ollama の "llama3:8b" のようにモデル名自体に ":"
 * を含む場合があるため、先頭が既知の provider 名のときだけ分割する。
 */
export function parseQaModelDescriptor(descriptor: string): QaModelSelection {
  const separator = descriptor.indexOf(":");
  if (separator > 0) {
    const prefix = descriptor.slice(0, separator);
    if (
      prefix !== DEFAULT_QA_MODEL_PROVIDER &&
      (QA_MODEL_PROVIDERS as readonly string[]).includes(prefix)
    ) {
      return {
        provider: prefix as QaModelProvider,
        model: descriptor.slice(separator + 1)
      };
    }
  }
  return { provider: DEFAULT_QA_MODEL_PROVIDER, model: descriptor };
}

export function configQaModelDescriptor(
  config: Pick<SekisyoConfig, "model" | "provider">
): string {
  return qaModelDescriptor(selectQaModel(config));
}
