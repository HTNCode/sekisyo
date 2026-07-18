#!/usr/bin/env bun

import { formatCliError, runCli } from "../cli.ts";

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  console.error(`sekisyo: ${formatCliError(error)}`);
  process.exitCode = 1;
}
