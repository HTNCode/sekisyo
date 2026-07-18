import { expect, test } from "bun:test";
import { join } from "node:path";
import { SEKISYO_VERSION } from "../../src/version.ts";

test("CLI version matches package.json", async () => {
  const packageJson = (await Bun.file(
    join(import.meta.dir, "..", "..", "package.json")
  ).json()) as { readonly version?: unknown };

  expect(packageJson.version).toBe(SEKISYO_VERSION);
});
