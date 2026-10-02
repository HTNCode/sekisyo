import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AtomicJsonSessionStore } from "../../../../src/adapters/filesystem/atomic-json-session-store.ts";
import { fingerprint } from "../../../../src/domain/fingerprint.ts";
import {
  createSessionRecord,
  transitionSession
} from "../../../../src/domain/session.ts";

const temporaryDirectories: string[] = [];

async function createStateDirectoryPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "sekisyo-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "state");
}

async function createStore(): Promise<AtomicJsonSessionStore> {
  return new AtomicJsonSessionStore(await createStateDirectoryPath());
}

function createRecord() {
  return createSessionRecord(
    {
      base: "base",
      head: "head",
      remote: "origin",
      ref: "refs/heads/main",
      diffDigest: fingerprint("diff"),
      policyDigest: fingerprint("policy"),
      promptVersion: "v1",
      model: "gpt-5.6-sol"
    },
    "2026-07-18T12:00:00.000Z"
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("AtomicJsonSessionStore", () => {
  test("新規作成した記録ディレクトリは0o700になる", async () => {
    const stateDirectory = await createStateDirectoryPath();
    const store = new AtomicJsonSessionStore(stateDirectory);

    await store.save(createRecord());

    const stats = await stat(stateDirectory);
    expect(stats.mode & 0o777).toBe(0o700);
  });

  test("既存の記録ディレクトリが緩いモードなら0o700へ締め直す", async () => {
    const stateDirectory = await createStateDirectoryPath();
    await mkdir(stateDirectory, { recursive: true });
    await chmod(stateDirectory, 0o777);
    const store = new AtomicJsonSessionStore(stateDirectory);

    await store.save(createRecord());

    const stats = await stat(stateDirectory);
    expect(stats.mode & 0o777).toBe(0o700);
  });

  test("実行ビットが落ちた既存ディレクトリも0o700へ直す", async () => {
    const stateDirectory = await createStateDirectoryPath();
    await mkdir(stateDirectory, { recursive: true });
    await chmod(stateDirectory, 0o600);
    const store = new AtomicJsonSessionStore(stateDirectory);

    await store.save(createRecord());

    const stats = await stat(stateDirectory);
    expect(stats.mode & 0o777).toBe(0o700);
  });

  test("`.git`のない任意ディレクトリへ保存して読み込む", async () => {
    const store = await createStore();
    const session = createRecord();
    await store.save(session);
    expect(await store.load(session.fingerprint)).toEqual(session);
  });

  test("既存セッションをatomicに置換する", async () => {
    const store = await createStore();
    const initial = createRecord();
    const analyzed = transitionSession(
      initial,
      "analyzed",
      "2026-07-18T12:01:00.000Z",
      {
        analysis: {
          summary: "Summary",
          filesChanged: 1,
          attention: [],
          findings: [],
          risks: []
        }
      }
    );
    await store.save(initial);
    await store.save(analyzed);
    expect((await store.load(initial.fingerprint))?.status).toBe("analyzed");
  });

  test("存在しないセッションはnullを返す", async () => {
    const store = await createStore();
    expect(await store.load(fingerprint("missing"))).toBeNull();
  });

  test("セッションの一覧取得と削除ができる", async () => {
    const store = await createStore();
    const session = createRecord();
    await store.save(session);
    expect(await store.list()).toEqual([session]);
    await store.remove(session.fingerprint);
    expect(await store.list()).toEqual([]);
  });

  test("パストラバーサルになるキーを拒否する", async () => {
    const store = await createStore();
    expect(store.load("../session")).rejects.toThrow("SHA-256 digest");
  });

  test("永続化対象外フィールドを拒否する", async () => {
    const store = await createStore();
    const unsafe = {
      ...createRecord(),
      rawDiff: "secret diff"
    };
    expect(store.save(unsafe)).rejects.toThrow();
  });
});
