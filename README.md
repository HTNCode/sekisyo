<p align="center">
  <img src="assets/sekisyo-cli-icon.jpg" alt="Sekisyo CLI icon" width="480">
</p>

# Sekisyo CLI

> **⚠️ 本ソフトウェアは試験段階のプレビュー版です。**

> We do not reject AI-written code. We reject unexplained code.

Sekisyo is a worker-first, pre-push accountability gate for AI-assisted
development. It helps the author understand and explain a change _before_ it
enters a review queue, so reviewer load decreases as a consequence of stronger
authors—not by asking reviewers to process even more automation.

**関所（Sekisyo）**
は、AI生成コードを禁止するツールではありません。作成者が変更の境界条件・波及影響・代替案・失敗時の挙動を説明できる状態に育ててから、レビューへ届けるためのCLIです。

## Demo

[![Sekisyo CLI demo preview](assets/demo/sekisyo-demo-preview.gif)](https://github.com/HTNCode/sekisyo/raw/refs/heads/main/assets/demo/sekisyo-demo.mp4)

[Watch the full 2:03 demo with Japanese narration and English captions](https://github.com/HTNCode/sekisyo/raw/refs/heads/main/assets/demo/sekisyo-demo.mp4).
The preview above is an embedded, 30-second README-friendly version.

The narration is an AI-generated voice created with the OpenAI Audio API using
`gpt-4o-mini-tts-2025-12-15` and the `marin` voice; it is not a human voice.

## Why

AI can produce code faster than humans can review it. The bottleneck is no
longer typing; it is accountable understanding.

Sekisyo deliberately allows:

- using AI to write code;
- using AI to help answer the oral examination;
- bypassing the local hook with `git push --no-verify`.

The product judges concrete, repository-specific explanations—not whether the
answer "sounds human." Teams that need enforcement can enable the included PR
record check.

## What happens before push

```text
git push
   │
   ├─ Codex inspects the committed diff and repository context
   ├─ mechanical findings are handled in a first self-review
   ├─ GPT-5.6 asks 3–5 evidence-backed questions
   ├─ vague answers receive a focused follow-up
   └─ a disposable pass record is stored under Git's private directory
```

`git push` does not generate a PR summary. After an exact matching passed record
has been selected, `sekisyo pr` asks GPT-5.6 to turn it into:

- design decisions;
- risks and edge cases;
- verification evidence;
- an attention map that distinguishes mechanical, routine, and must-read
  changes;
- the author's Q&A.

The generated summary is first saved as a summarized local record. Sekisyo then
creates or updates the PR body and, only after that write succeeds, marks the
local record as published. An already summarized record is reused on retry
without another summary call. The PR body is the permanent record; a published
local record holds the same content and is kept only so that a later push can
tell which commits were already examined (see
[Examining at commit time](#examining-at-commit-time-optional)). Remove local
records at any time with `sekisyo clean --all`.

## Examining at commit time (optional)

The gate always runs at push. To also examine each commit as you make it, turn
it on in `.sekisyo.yml` and run `sekisyo init` again so the `pre-commit` hook is
installed:

```yaml
triggers:
  commit: true
```

- The examination covers only the staged changes. The analysis engine sees the
  files exactly as they will be committed.
- It runs only when a person commits from an interactive terminal. Commits made
  by an agent (such as Claude Code), an IDE, or a script have no terminal, so
  they pass with a notice and are examined at push instead.
- At push, if every commit being pushed was examined at commit time, the push
  examination is skipped. Sekisyo combines those records into one pass record
  for the push, so `sekisyo pr` works as usual. Commits already on the remote
  count as covered when the push that put them there passed.
- A commit is matched by its parent and its tree, not by diff text. Anything
  that changes either one sends the push back to a full examination: rebase,
  cherry-pick, `--amend`, a merge commit, or a commit made without the
  examination (an agent's commit, the first commit, or `--no-verify`).
- `triggers` is not part of the policy digest, so turning it on or off keeps
  existing pass records valid. `sekisyo uninstall` removes both hooks.

## How Sekisyo uses Codex and GPT-5.6

Sekisyo gives Codex and GPT-5.6 different responsibilities:

| Technology                               | How Sekisyo uses it                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Codex CLI**                            | Runs headlessly at the pre-push gate to analyze the committed diff together with repository context. It returns structured findings, risks, and an attention map that classifies changed areas as mechanical, routine, or must-read.                                                                                           |
| **GPT-5.6 via the OpenAI Responses API** | Uses the structured Codex analysis and the repository's question taxonomy to generate the oral examination, judge whether each answer is specific and verifiable, and ask a focused follow-up when an answer is vague. Only `sekisyo pr`, after selecting an exact matching passed record, summarizes the Q&A for the PR body. |

Codex answers **“what changed, where should attention go, and what could go
wrong?”** GPT-5.6 then asks **“can the author explain those decisions and
risks?”** This separation keeps the product focused on developing the author:
neither model is used to detect whether code or an answer was written by AI.

GPT-5.6 calls use strict structured outputs and `store: false`. The local pass
record stays under Git's private directory; after `sekisyo pr` transfers the
explanation record to the pull request body, it is kept there as published until
`sekisyo clean --all`.

Each side takes its model from its own key in `.sekisyo.yml`. The top-level
`model` selects the OpenAI model used for the oral examination, and
`analysis.model` selects the model passed to the Codex CLI as `--model`:

```yaml
model: gpt-5.6-sol # oral examination (OpenAI Responses API)
analysis:
  model: gpt-5.6-codex # diff analysis (Codex CLI)
```

Omit `analysis.model` to use the Codex CLI's built-in default. Sekisyo always
runs Codex with `--ignore-user-config`, so a model set in `~/.codex/config.toml`
is not used; `analysis.model` is the only way to choose the analysis model. The
value must be a plain model identifier that your Codex CLI accepts. Both keys
are part of the policy digest, so changing either invalidates existing pass
records.

### Choosing the oral-examination provider

The optional top-level `provider` selects who answers the oral examination. It
defaults to `openai`, so existing configurations keep working unchanged.

| `provider`          | API used                                   | Credentials (environment only)                     | `model` when omitted |
| ------------------- | ------------------------------------------ | -------------------------------------------------- | -------------------- |
| `openai`            | OpenAI Responses API, `store: false`       | `OPENAI_API_KEY`                                   | `gpt-5.6-sol`        |
| `anthropic`         | Anthropic Messages API, structured outputs | `ANTHROPIC_API_KEY` (or the SDK's other sources)   | `claude-opus-5-5`    |
| `google`            | Gemini API, JSON schema response           | `GEMINI_API_KEY` or `GOOGLE_API_KEY`               | required             |
| `openai-compatible` | Chat Completions with a JSON schema        | `SEKISYO_OPENAI_COMPATIBLE_BASE_URL`, optional key | required             |

```yaml
provider: anthropic
model: claude-opus-5-5
```

`openai-compatible` covers servers such as Ollama, LM Studio, or OpenRouter. Set
the endpoint in `SEKISYO_OPENAI_COMPATIBLE_BASE_URL` (for example
`http://localhost:11434/v1`) and, if the server needs one, the key in
`SEKISYO_OPENAI_COMPATIBLE_API_KEY`. The server must support JSON-schema
structured output. Endpoints and keys are read only from the environment, never
from `.sekisyo.yml`: the file is committed, so a cloned repository could
otherwise send your key or your answers to an address of its choosing. Sekisyo
never sends `OPENAI_API_KEY` or the OpenAI organization and project settings to
an OpenAI-compatible endpoint.

With `provider: anthropic` and a model that supports it, Sekisyo enables
Anthropic's server-side fallback: if a request is declined for safety reasons,
Anthropic reruns it on a fallback model and bills that run at the fallback
model's rates.

`provider` is part of the policy digest, so switching providers invalidates
existing pass records.

### Choosing the diff-analysis engine

`analysis.engine` selects who analyzes the diff before the oral examination. It
defaults to `codex`, so existing configurations keep working unchanged.

| `analysis.engine` | How it runs                                                                                                                             | `analysis.model`                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `codex`           | Codex CLI on the sanitized snapshot, read-only and ephemeral, ignoring user configuration                                               | `--model` for Codex                                       |
| `claude-code`     | Claude Code CLI (`claude -p`) on the same snapshot with `--restricted`, only the Read, Grep, and Glob tools, and no session persistence | `--model` for Claude Code                                 |
| `api`             | Sends only the bounded diff to the oral-examination `provider` with structured output; no repository access                             | model at that provider; defaults to the top-level `model` |

```yaml
provider: anthropic
analysis:
  engine: api
```

`claude-code` needs Claude Code installed and signed in (a subscription login or
`ANTHROPIC_API_KEY`). `--restricted` removes the command-running tools, confines
file access to the snapshot, and ignores user, project, and local settings; a
run with it did not load `~/.claude/CLAUDE.md`. Besides the sign-in variables,
only proxy settings (`HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY`, `NO_PROXY`) and
`NODE_EXTRA_CA_CERTS` are forwarded, so it also works behind a proxy.

`api` does not explore the repository, so it is usually quicker and uses fewer
tokens, but it sees only the diff: callers and other unchanged code are
invisible to it, so its findings are shallower. Every engine sends code to a
model service: the CLI engines send the snapshot and diff to their own service
(OpenAI for Codex, Anthropic for Claude Code), and the oral-examination model
then receives only the structured analysis. With `api`, the raw diff goes to the
oral-examination `provider` itself.

`analysis.engine` is part of the policy digest, so switching engines invalidates
existing pass records.

## Commands

| Command                 | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `sekisyo init`          | Install the pre-push hook and create `.sekisyo.yml` |
| `sekisyo uninstall`     | Remove the Sekisyo hooks from this repo             |
| `sekisyo ask`           | Run the self-review and oral examination early      |
| `sekisyo status`        | Show the current commit's gate state                |
| `sekisyo pr`            | Create or update a PR with the Sekisyo record       |
| `sekisyo clean`         | Remove disposable local records                     |
| `sekisyo git <args...>` | Always pass arguments through to the real Git       |
| `sekisyo <git args...>` | Pass unknown commands through to the real Git       |

`init`, `uninstall`, `ask`, `status`, `pr`, and `clean` accept `--help` and
`--version` in any position, so `sekisyo status --help` prints the usage text
and exits with 0. The internal `hook` subcommand is not covered: it accepts
`--help` or `-h` only directly after `hook`, so that `sekisyo hook pre-push` can
never be turned into a successful no-op that skips the gate. Arguments after
`sekisyo git` and after an unknown Git command are always handed to the real Git
untouched.

The hook starts the interactive examination when a terminal is available. A push
from an IDE or another non-interactive process fails safely and explains how to
complete `sekisyo ask` first.

### Optional Git wrapper

`sekisyo init` can show an opt-in shell wrapper. This is only a convenience
layer: the pre-push hook works without it. The safe wrapper routes only
`git ask` and `git pr` to Sekisyo, while existing commands such as `git init`,
`git status`, and `git clean` continue to invoke the real Git. Run
`sekisyo status`, `sekisyo clean`, and `sekisyo init` explicitly.

`sekisyo init --show-alias` prints the wrapper without asking, and
`sekisyo init --no-alias` skips the question entirely, which keeps the command
usable from non-interactive setup scripts.

## Exit codes

Exit codes describe the kind of cause rather than the individual error, so that
adding an internal error category does not shift the numbers.

| Code | Meaning                                                                      |
| ---- | ---------------------------------------------------------------------------- |
| 0    | Success                                                                      |
| 1    | The gate did not pass, or a general failure                                  |
| 2    | The user stopped the run (declined a confirmation, chose to fix the code)    |
| 3    | The environment stopped the run (no interactive terminal, input reached EOF) |
| 4    | A `privacy.exclude` pattern matched a changed path, so the diff was unread   |

`sekisyo git <args...>` and unknown Git commands return the exit code of the
real Git process unchanged.

Code 4 is currently reached only by the privacy exclusion above. A malformed
`.sekisyo.yml` and a diff over `analysis.maxChangedFiles` both exit with 1, so
do not branch on 4 to detect configuration mistakes.

These numbers replace the earlier behavior of returning 1 for every failure. A
script that tests `$? -eq 1` to detect any failure needs to test `$? -ne 0`
instead.

## Measuring where the wait goes

Set `SEKISYO_DEBUG_TIMING=1` to print the duration of each phase to stderr:

```console
$ SEKISYO_DEBUG_TIMING=1 sekisyo ask
sekisyo[timing] git-state 38.2ms
sekisyo[timing] snapshot:init 3.1ms
sekisyo[timing] snapshot:objects 2.7ms
sekisyo[timing] snapshot:probe 0.5ms
sekisyo[timing] snapshot:extract 6.3ms
sekisyo[timing] snapshot:sanitize 1.4ms
sekisyo[timing] snapshot 14.2ms
sekisyo[timing] codex-analysis 21430.7ms
sekisyo[timing] question-generation 4820.1ms
sekisyo[timing] answer-judgment 3110.4ms
```

`snapshot:*` lines break the snapshot phase down, and the bare `snapshot` line
is their total. `answer-judgment` is printed once per answer. Any value other
than empty, `0`, `false`, `no`, or `off` enables the output, ignoring case and
surrounding whitespace; unset leaves it off, and nothing is written to stdout
either way.

## Installation

### Requirements

- Bun 1.2 or newer;
- Git;
- a standard `tar` executable available on `PATH`;
- [Codex CLI](https://developers.openai.com/codex/cli/) installed and
  authenticated;
- credentials for the oral-examination provider available to the Sekisyo process
  (`OPENAI_API_KEY` by default; see
  [Choosing the oral-examination provider](#choosing-the-oral-examination-provider));
- GitHub CLI (`gh`) authenticated only if you use `sekisyo pr`.

Until the package is published, install Sekisyo from source:

```bash
git clone https://github.com/HTNCode/sekisyo.git
cd sekisyo
bun install --frozen-lockfile
bun link
sekisyo init
```

`sekisyo init` installs the managed `pre-push` hook and creates `.sekisyo.yml`.
It does not replace an unmanaged existing hook. Once the package is published,
the intended one-command entrypoint is:

```bash
bunx sekisyo init
```

### Per-repository adoption

`bun link` only puts the `sekisyo` command on `PATH`; no repository is gated
until you run `sekisyo init` inside it. To opt a repository out again, run
`sekisyo uninstall`. It removes only a hook that Sekisyo installed and keeps
`.sekisyo.yml`, which is shared team configuration.

If `core.hooksPath` is set outside the repository (for example in
`~/.gitconfig`), that directory is shared by every repository, so `sekisyo init`
does not write there. It installs the hook in the repository's own `hooks`
directory under `git rev-parse --git-common-dir` instead, which also covers
linked worktrees, and prints a notice. Git does not run that hook on its own
while the shared `core.hooksPath` is active, so the shared `pre-push` must hand
over to it at the end:

```sh
hook="$(git rev-parse --git-common-dir)/hooks/pre-push"
if [ -x "$hook" ]; then exec "$hook" "$@"; fi
```

If the shared hook reads standard input first, save it and pass the same content
to the repository hook. A `core.hooksPath` set in the repository's own
configuration (such as husky's `.husky`) is used as before. With
`triggers.commit: true`, the same applies to `pre-commit`: the shared
`pre-commit` must hand over to `hooks/pre-commit` in the same way.

## Supported platforms

| Area              | Support                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Operating systems | Windows 10/11 with Git for Windows, macOS, and Linux                                           |
| Git hosting       | The pre-push gate works with GitHub, GitLab, and self-hosted Git remotes                       |
| PR write-back     | `sekisyo pr` currently supports GitHub through GitHub CLI                                      |
| Invocation        | Interactive terminals; IDE and agent pushes fail safely until `sekisyo ask` has been completed |
| Git object format | SHA-1 and SHA-256 repositories                                                                 |

The CLI targets every platform on which Bun, Git, and Codex CLI are available.
The CI workflow runs the automated suite on `ubuntu-latest`; Windows behavior is
also covered by platform-specific code and local validation.

## Testing

Install the locked dependencies, then run the complete local quality gate:

```bash
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run format:check
bun test
bun run build
bun run compile
```

The automated suite uses fakes and temporary Git repositories, so it does not
spend OpenAI credits or create GitHub pull requests. A manual end-to-end check
requires authenticated Codex CLI, `OPENAI_API_KEY`, and—only for PR
write-back—authenticated GitHub CLI.

## Question taxonomy

The taxonomy is public policy, not a hidden prompt:

```yaml
questions:
  count: 3
  categories:
    boundary: true
    ripple: true
    alternatives: true
    failure: true
    performance: false
  custom:
    - name: accessibility
      prompt: >-
        For UI changes, ask about keyboard and screen-reader behavior.
    - name: ownership
      required: true
      prompt: >-
        Name the team that owns the changed module after this change.
  paths:
    "src/billing/**":
      categories:
        failure: required
```

You can create a repository-specific question taxonomy entirely in
`.sekisyo.yml`; no Sekisyo source changes are required. Set each built-in
category to `true`, `false`, or `required`, add domain-specific question types
under `custom` with a unique `name` and concrete `prompt` (a duplicate `name`,
or one that matches a built-in category such as `boundary`, is rejected when the
config is loaded; names are compared after trimming surrounding whitespace and
are case-sensitive), and use `paths` to strengthen built-in categories for
matching files. For example, a frontend team can add accessibility guidance,
while a billing path can require a failure behavior question.

A `custom` entry is optional by default. Add `required: true` to it when the
question must always be asked. Keep `questions.count` at least as large as the
number of built-in categories that are `required` once any matching `paths`
override has been applied, plus the number of `custom` entries marked
`required`. Because `paths` overrides depend on which files changed, the count
is checked at run time: the gate aborts after the diff analysis, not when the
config is loaded.

Generated questions carry a fixed category set, so every custom question is
reported as `custom`. Sekisyo can therefore verify that at least as many custom
questions were generated as there are required `custom` entries, but not which
named entry each one came from. Adding or removing `required` changes the policy
digest, so it invalidates existing pass records like any other policy change.

The four default categories avoid summary questions:

1. **Boundary conditions** — what happens for empty, maximum, missing, or
   concurrent input?
2. **Ripple effects** — what happens to callers and paths that were not
   modified?
3. **Rejected alternatives** — why was an existing primitive or simpler design
   not selected?
4. **Failure behavior** — what remains partially written, cached, or visible
   after an error?

## Review strictness

The overall review intensity is a single key in `.sekisyo.yml`:

```yaml
strictness: standard # light | standard | strict
```

The level is applied in two places: the Codex analysis prompt (which issues are
reported as findings) and the answer-judgment prompt (what an answer needs to
pass the oral review and the self-review explanations).

- **light** — findings only include issues with real impact: bugs, security
  problems, data corruption, and clear specification violations. Style and minor
  maintainability notes are skipped. An answer passes when the purpose of the
  change and its cause-and-effect are explained in the author's own words;
  exhaustive boundary conditions and trade-offs are not required. Explanations
  grounded in the change's purpose, use case, or operational premises can pass
  even without referencing specific lines or identifiers, as long as they are
  consistent with the finding and show the reasoning behind the decision; the
  rubric is treated as a reference, not a checklist.
- **standard** (default) — findings cover concrete problems worth checking
  before push, excluding taste-only style remarks. An answer must connect the
  change to its evidence and causality, plus boundary conditions or trade-offs.
- **strict** — findings additionally cover maintainability, readability, missing
  tests, and performance concerns. An answer must satisfy the full rubric and
  explain boundary conditions, trade-offs, and how the change was verified;
  ambiguous answers fail.

Canned answers such as "no problem" or "as specified" fail at every level.
`strictness` is part of the policy digest, so changing it invalidates existing
pass records like any other policy change.

## Security and privacy

- API keys and raw diffs are never written to pass records or PR bodies.
- A diff touching a `privacy.exclude` path is stopped before its contents are
  read. Codex receives only the exact HEAD tree—without repository history—in an
  isolated snapshot with Git metadata, symlinks, agent-control files, and
  excluded paths removed; the exact bounded diff is supplied separately as data.
  Snapshot preparation archives only the requested commit—reading the source
  object store read-only through a throwaway staging repository rather than
  copying objects—and neutralizes `export-ignore` and `export-subst`, so tracked
  files are neither omitted nor rewritten by archive policy. The staging
  repository is deleted before the snapshot is extracted, so Codex never sees
  it.
- Child processes are launched with argument arrays, never a shell string.
- Codex runs read-only and ephemerally.
- The OpenAI key is not forwarded to the Codex child process.
- Recognizable credentials, raw HTML, and GitHub mentions are blocked or
  neutralized before Q&A and summaries are written to a PR.
- Diff size and changed-file limits are configurable.
- Pass records are tied to the pushed commit, base, remote/ref, taxonomy, prompt
  version, and model.
- Amend, rebase, reset, or policy changes invalidate the record.

With the default `codex` engine (and with `claude-code`), the analysis CLI
receives repository context and the oral-examination model receives only the
structured analysis and the author's Q&A, not the raw diff. With
`analysis.engine: api`, the raw diff itself is sent to the configured
`provider`. The snapshot guarantees above apply to the Claude Code engine as
well, and only the variables Claude Code needs to sign in are forwarded to it.
Authors must still avoid putting credentials into answers: accepted answers are
intentionally saved locally, and stay there after `sekisyo pr` publishes them
until `sekisyo clean --all`.

Sekisyo is an accountability aid, not a security boundary. Both local records
and PR markers are editable, and `--no-verify` remains available by design.

## Architecture

```text
commands → application → domain + ports ← adapters
                                      ├─ Git / gh
                                      ├─ Codex CLI
                                      ├─ OpenAI / Anthropic / Gemini /
                                      │  OpenAI-compatible model APIs
                                      ├─ filesystem session store
                                      └─ terminal
```

External systems are behind ports so the normal test suite uses fakes. Live
Codex, model-provider, and GitHub checks are performed separately as manual
smoke tests.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development details and
[SECURITY.md](SECURITY.md) for reporting security issues. The Japanese
[Project Story](PROJECT_STORY.md) explains the motivation, design decisions, and
current implementation. An equivalent
[English Project Story](PROJECT_STORY_EN.md) is also available.

## License

MIT
