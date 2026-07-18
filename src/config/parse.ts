import { YAML } from "bun";
import { join } from "node:path";
import { fingerprint } from "../domain/fingerprint.ts";
import { DEFAULT_CONFIG } from "./defaults.ts";
import { SekisyoConfigSchema, type SekisyoConfig } from "./schema.ts";

export const SEKISYO_CONFIG_FILE = ".sekisyo.yml";

export const SEKISYO_CONFIG_TEMPLATE = `version: 1
model: gpt-5.6-sol
questions:
  count: 3
  maxFollowUps: 2
  categories:
    boundary: true
    ripple: true
    alternatives: true
    failure: true
    performance: false
  custom: []
  paths: {}
analysis:
  maxChangedFiles: 200
  maxDiffBytes: 1000000
  timeoutSeconds: 180
privacy:
  exclude:
    - "**/.env*"
    - "**/secrets/**"
    - "**/*.pem"
    - "**/*.key"
`;

export function parseConfigYaml(source: string): SekisyoConfig {
  return SekisyoConfigSchema.parse(YAML.parse(source));
}

export function parseConfig(value: unknown): SekisyoConfig {
  return SekisyoConfigSchema.parse(value);
}

export function createPolicyDigest(config: SekisyoConfig): string {
  const normalizedConfig = SekisyoConfigSchema.parse(config);
  return fingerprint(JSON.stringify(normalizedConfig));
}

export async function loadSekisyoConfig(
  repoRoot: string
): Promise<SekisyoConfig> {
  const configFile = Bun.file(join(repoRoot, SEKISYO_CONFIG_FILE));
  if (!(await configFile.exists())) {
    return SekisyoConfigSchema.parse(DEFAULT_CONFIG);
  }
  return parseConfigYaml(await configFile.text());
}
