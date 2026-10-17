import { EXIT_CODE } from "../application/errors.ts";
import { findRepositoryRoot } from "../adapters/git/git-repository.ts";
import { SEKISYO_CONFIG_FILE } from "../config/parse.ts";
import { uninstallManagedHook, type ManagedHookName } from "../hook/install.ts";

const MANAGED_HOOKS: readonly ManagedHookName[] = ["pre-push", "pre-commit"];

/**
 * このリポジトリから Sekisyo のフック（pre-push と、設置されていれば pre-commit）
 * を外す。.sekisyo.yml はチームで共有するコミット対象の設定なので、ここでは消さない。
 */
export async function runUninstallCommand(cwd: string): Promise<number> {
  const repoRoot = await findRepositoryRoot(cwd);
  let exitCode: number = EXIT_CODE.success;
  for (const name of MANAGED_HOOKS) {
    const { hookPath, result } = await uninstallManagedHook(repoRoot, name);
    switch (result) {
      case "removed":
        console.log(`削除: ${hookPath}`);
        break;
      case "not_found":
        // pre-commit は commit 時の試問を有効にしたときだけ設置するため、無いのが通常。
        if (name === "pre-push") {
          console.log(`${name}フックは設置されていません: ${hookPath}`);
        }
        break;
      case "unmanaged":
        console.error(
          `Sekisyo が設置したものではない ${name} フックのため削除しませんでした: ${hookPath}`
        );
        exitCode = EXIT_CODE.failure;
        break;
    }
  }
  console.log(
    `${SEKISYO_CONFIG_FILE} は残しています。不要であれば手動で削除してください。`
  );
  return exitCode;
}
