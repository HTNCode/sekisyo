import { isObjectId, isZeroObjectId } from "../adapters/git/gitRepository.ts";

const DEFAULT_MAX_BYTES = 64 * 1024;
const DEFAULT_MAX_UPDATES = 100;

export interface PrePushUpdate {
  readonly localOid: string;
  readonly localRef: string;
  readonly remoteOid: string;
  readonly remoteRef: string;
}

export interface ParsePrePushOptions {
  readonly maxBytes?: number;
  readonly maxUpdates?: number;
}

export function shouldAssessUpdate(update: PrePushUpdate): boolean {
  return (
    update.remoteRef.startsWith("refs/heads/") &&
    !isZeroObjectId(update.localOid)
  );
}

export function parsePrePushInput(
  input: string,
  options: ParsePrePushOptions = {}
): readonly PrePushUpdate[] {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxUpdates = options.maxUpdates ?? DEFAULT_MAX_UPDATES;

  if (Buffer.byteLength(input, "utf8") > maxBytes) {
    throw new Error(`pre-push input exceeds ${maxBytes} bytes.`);
  }

  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > maxUpdates) {
    throw new Error(`pre-push input exceeds ${maxUpdates} updates.`);
  }

  return lines.map((line, index) => {
    const fields = line.split(/\s+/);
    if (fields.length !== 4) {
      throw new Error(`Invalid pre-push input on line ${index + 1}.`);
    }

    const [localRef, localOid, remoteRef, remoteOid] = fields;
    if (
      localRef === undefined ||
      localOid === undefined ||
      remoteRef === undefined ||
      remoteOid === undefined
    ) {
      throw new Error(`Invalid pre-push input on line ${index + 1}.`);
    }

    const localIsDeletion = localRef === "(delete)" && isZeroObjectId(localOid);
    if (!localIsDeletion && !isObjectId(localOid)) {
      throw new Error(`Invalid local object ID on line ${index + 1}.`);
    }
    if (!isObjectId(remoteOid) && !isZeroObjectId(remoteOid)) {
      throw new Error(`Invalid remote object ID on line ${index + 1}.`);
    }

    return {
      localOid,
      localRef,
      remoteOid,
      remoteRef
    };
  });
}
