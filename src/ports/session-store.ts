import type { SessionRecord } from "../domain/session.ts";

export interface SessionStore {
  load(fingerprint: string): Promise<SessionRecord | null>;
  list(): Promise<readonly SessionRecord[]>;
  save(session: SessionRecord): Promise<void>;
  remove(fingerprint: string): Promise<void>;
}
