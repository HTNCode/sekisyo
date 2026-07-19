#!/usr/bin/env bun

import { formatCliError, runCli } from "../cli.ts";

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  console.error(`sekisyo: ${formatCliError(error)}`);
  process.exitCode = 1;
}

// CONIN$ / /dev/tty の保留中読み取りはキャンセルできない場合があり、
// 自然終了を待つとpre-pushフックがgit pushをブロックし続けるため明示的に終了する。
process.exit();
