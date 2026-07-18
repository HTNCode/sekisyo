import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TemporaryOutputNotFoundError } from "./errors.ts";

const MAX_OUTPUT_BYTES = 2 * 1_024 * 1_024;

export interface CodexTemporaryWorkspace {
  readonly outputPath: string;
  readonly repositoryPath: string;
  readonly schemaPath: string;
  cleanup(): Promise<void>;
  readOutput(): Promise<string>;
}

export interface CodexTemporaryWorkspaceFactory {
  create(schema: string): Promise<CodexTemporaryWorkspace>;
}

class NodeCodexTemporaryWorkspace implements CodexTemporaryWorkspace {
  readonly #rootPath: string;
  readonly outputPath: string;
  readonly repositoryPath: string;
  readonly schemaPath: string;

  constructor(rootPath: string) {
    this.#rootPath = rootPath;
    this.schemaPath = join(rootPath, "output-schema.json");
    this.outputPath = join(rootPath, "analysis.json");
    this.repositoryPath = join(rootPath, "repository");
  }

  async cleanup(): Promise<void> {
    await rm(this.#rootPath, { force: true, recursive: true });
  }

  async readOutput(): Promise<string> {
    let outputStat;
    try {
      outputStat = await stat(this.outputPath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new TemporaryOutputNotFoundError();
      }
      throw error;
    }

    if (!outputStat.isFile() || outputStat.size > MAX_OUTPUT_BYTES) {
      throw new Error("Temporary output is not a bounded regular file.");
    }
    return readFile(this.outputPath, "utf8");
  }
}

export class NodeCodexTemporaryWorkspaceFactory implements CodexTemporaryWorkspaceFactory {
  async create(schema: string): Promise<CodexTemporaryWorkspace> {
    const rootPath = await mkdtemp(join(tmpdir(), "sekisyo-codex-"));
    const workspace = new NodeCodexTemporaryWorkspace(rootPath);
    try {
      await writeFile(workspace.schemaPath, schema, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      return workspace;
    } catch (error) {
      await workspace.cleanup();
      throw error;
    }
  }
}
