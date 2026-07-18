import type { SekisyoConfig } from "../config/schema.ts";
import type { DiffAnalysis } from "../domain/analysis.ts";
import type { QuestionCategoryRequest } from "../ports/qa-model.ts";

const BUILT_IN_CATEGORIES = [
  "boundary",
  "ripple",
  "alternatives",
  "failure",
  "performance"
] as const;

type BuiltInCategory = (typeof BUILT_IN_CATEGORIES)[number];
type CategorySetting = boolean | "required";

export function matchesGlob(path: string, pattern: string): boolean {
  const normalizedPath = path.replaceAll("\\", "/");
  const normalizedPattern = pattern.replaceAll("\\", "/");
  if (process.platform === "win32") {
    return new Bun.Glob(normalizedPattern.toLowerCase()).match(
      normalizedPath.toLowerCase()
    );
  }
  return new Bun.Glob(normalizedPattern).match(normalizedPath);
}

function normalizePrivacyGlobValue(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}

export function createPrivacyPathMatcher(
  patterns: readonly string[]
): (path: string) => boolean {
  const globs = patterns.map(
    (pattern) => new Bun.Glob(normalizePrivacyGlobValue(pattern))
  );
  return (path) => {
    const normalizedPath = normalizePrivacyGlobValue(path);
    return globs.some((glob) => glob.match(normalizedPath));
  };
}

export function matchesPrivacyGlob(path: string, pattern: string): boolean {
  return createPrivacyPathMatcher([pattern])(path);
}

function changedPaths(analysis: DiffAnalysis): ReadonlySet<string> {
  return new Set([
    ...analysis.attention.map((item) => item.path),
    ...analysis.findings.map((finding) => finding.path)
  ]);
}

export function resolveQuestionCategories(
  config: SekisyoConfig,
  analysis: DiffAnalysis,
  changedFiles: readonly string[] = []
): readonly QuestionCategoryRequest[] {
  const settings: Record<BuiltInCategory, CategorySetting> = {
    ...config.questions.categories
  };
  const paths = new Set([...changedPaths(analysis), ...changedFiles]);

  for (const [pattern, override] of Object.entries(config.questions.paths)) {
    if (![...paths].some((path) => matchesGlob(path, pattern))) {
      continue;
    }
    for (const category of BUILT_IN_CATEGORIES) {
      const setting = override.categories[category];
      if (setting === undefined) {
        continue;
      }
      if (setting === "required" || settings[category] !== "required") {
        settings[category] = setting;
      }
    }
  }

  const builtIn = BUILT_IN_CATEGORIES.flatMap((name) => {
    const setting = settings[name];
    return setting === false
      ? []
      : [{ name, required: setting === "required" }];
  });
  const custom = config.questions.custom.map((category) => ({
    name: category.name,
    prompt: category.prompt,
    required: false
  }));

  return [...builtIn, ...custom];
}

export function excludedDiffPaths(
  changedFiles: readonly string[],
  patterns: readonly string[]
): readonly string[] {
  const matchesPrivacyPath = createPrivacyPathMatcher(patterns);
  return [...new Set(changedFiles)].filter(matchesPrivacyPath);
}
