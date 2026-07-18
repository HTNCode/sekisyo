import { randomUUID } from "node:crypto";
import {
  mkdir,
  lstat,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import {
  SessionRecordSchema,
  type SessionRecord
} from "../../domain/session.ts";
import type { SessionStore } from "../../ports/session-store.ts";

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function assertNotSymbolicLink(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) {
      throw new Error(`Symbolic links are not allowed: ${path}`);
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error;
    }
  }
}

export function sessionFilePath(
  stateDirectory: string,
  fingerprint: string
): string {
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    throw new Error("Session fingerprint must be a SHA-256 digest.");
  }
  return join(stateDirectory, `${fingerprint}.json`);
}

export class AtomicJsonSessionStore implements SessionStore {
  public constructor(private readonly stateDirectory: string) {}

  public async load(fingerprint: string): Promise<SessionRecord | null> {
    const filePath = sessionFilePath(this.stateDirectory, fingerprint);
    await assertNotSymbolicLink(this.stateDirectory);
    await assertNotSymbolicLink(filePath);
    let source: string;
    try {
      source = await readFile(filePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }

    const value: unknown = JSON.parse(source);
    return SessionRecordSchema.parse(value);
  }

  public async list(): Promise<readonly SessionRecord[]> {
    await assertNotSymbolicLink(this.stateDirectory);
    let entries: string[];
    try {
      entries = await readdir(this.stateDirectory);
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

    const fingerprints = entries
      .filter((entry) => /^[0-9a-f]{64}\.json$/.test(entry))
      .map((entry) => entry.slice(0, -".json".length))
      .sort();
    const sessions = await Promise.all(
      fingerprints.map((value) => this.load(value))
    );
    return sessions.filter(
      (session): session is SessionRecord => session !== null
    );
  }

  public async save(session: SessionRecord): Promise<void> {
    const normalized = SessionRecordSchema.parse(session);
    const destination = sessionFilePath(
      this.stateDirectory,
      normalized.fingerprint
    );
    const temporary = join(
      this.stateDirectory,
      `.${normalized.fingerprint}.${process.pid}.${randomUUID()}.tmp`
    );
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;

    await assertNotSymbolicLink(this.stateDirectory);
    await mkdir(this.stateDirectory, {
      recursive: true,
      mode: 0o700
    });
    await assertNotSymbolicLink(this.stateDirectory);
    await assertNotSymbolicLink(destination);

    try {
      await writeFile(temporary, serialized, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  public async remove(fingerprint: string): Promise<void> {
    const filePath = sessionFilePath(this.stateDirectory, fingerprint);
    await assertNotSymbolicLink(this.stateDirectory);
    await assertNotSymbolicLink(filePath);
    try {
      await unlink(filePath);
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
    }
  }
}
