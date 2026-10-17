import { EXIT_CODE } from "../application/errors.ts";
import { findRepositoryRoot } from "../adapters/git/git-repository.ts";
import { SEKISYO_CONFIG_FILE } from "../config/parse.ts";
import { uninstallPrePushHook } from "../hook/install.ts";

/**
 * このリポジトリから Sekisyo の pre-push フックを外す。.sekisyo.yml はチームで
 * 共有するコミット対象の設定なので、ここでは消さない。
 */
export async function runUninstallCommand(cwd: string): Promise<number> {
  const repoRoot = await findRepositoryRoot(cwd);
  const { hookPath, result } = await uninstallPrePushHook(repoRoot);
  switch (result) {
    case "removed":
      console.log(`削除: ${hookPath}`);
      break;
    case "not_found":
      console.log(`pre-pushフックは設置されていません: ${hookPath}`);
      break;
    case "unmanaged":
      console.error(
        `Sekisyo が設置したものではない pre-push フックのため削除しませんでした: ${hookPath}`
      );
      return EXIT_CODE.failure;
  }
  console.log(
    `${SEKISYO_CONFIG_FILE} は残しています。不要であれば手動で削除してください。`
  );
  return EXIT_CODE.success;
}
