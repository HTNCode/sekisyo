<p align="center">
  <img src="assets/sekisyo-cli-icon.jpg" alt="Sekisyo CLI icon" width="480">
</p>

# Sekisyo CLI

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

`sekisyo pr` turns that disposable record into:

- design decisions;
- risks and edge cases;
- verification evidence;
- an attention map that distinguishes mechanical, routine, and must-read
  changes;
- the author's Q&A.

Only the PR body is permanent. Local pass records are disposable.

## How Sekisyo uses Codex and GPT-5.6

Sekisyo gives Codex and GPT-5.6 different responsibilities:

| Technology                               | How Sekisyo uses it                                                                                                                                                                                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Codex CLI**                            | Runs headlessly at the pre-push gate to analyze the committed diff together with repository context. It returns structured findings, risks, and an attention map that classifies changed areas as mechanical, routine, or must-read.                             |
| **GPT-5.6 via the OpenAI Responses API** | Uses the structured Codex analysis and the repository's question taxonomy to generate the oral examination, judge whether each answer is specific and verifiable, ask a focused follow-up when an answer is vague, and summarize the passed Q&A for the PR body. |

Codex answers **“what changed, where should attention go, and what could go
wrong?”** GPT-5.6 then asks **“can the author explain those decisions and
risks?”** This separation keeps the product focused on developing the author:
neither model is used to detect whether code or an answer was written by AI.

GPT-5.6 calls use strict structured outputs and `store: false`. The local pass
record remains under Git's private directory until `sekisyo pr` successfully
transfers the explanation record to the pull request body.

## Commands

| Command                 | Purpose                                             |
| ----------------------- | --------------------------------------------------- |
| `sekisyo init`          | Install the pre-push hook and create `.sekisyo.yml` |
| `sekisyo ask`           | Run the self-review and oral examination early      |
| `sekisyo status`        | Show the current commit's gate state                |
| `sekisyo pr`            | Create or update a PR with the Sekisyo record       |
| `sekisyo clean`         | Remove disposable local records                     |
| `sekisyo git <args...>` | Always pass arguments through to the real Git       |
| `sekisyo <git args...>` | Pass unknown commands through to the real Git       |

The hook starts the interactive examination when a terminal is available. A push
from an IDE or another non-interactive process fails safely and explains how to
complete `sekisyo ask` first.

### Optional Git wrapper

`sekisyo init` can show an opt-in shell wrapper. This is only a convenience
layer: the pre-push hook works without it. The safe wrapper routes only
`git ask` and `git pr` to Sekisyo, while existing commands such as `git init`,
`git status`, and `git clean` continue to invoke the real Git. Run
`sekisyo status`, `sekisyo clean`, and `sekisyo init` explicitly.

## Installation

### Requirements

- Bun 1.2 or newer;
- Git;
- [Codex CLI](https://developers.openai.com/codex/cli/) installed and
  authenticated;
- an `OPENAI_API_KEY` available to the Sekisyo process for GPT-5.6;
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
  paths:
    "src/billing/**":
      categories:
        failure: required
```

The four default categories avoid summary questions:

1. **Boundary conditions** — what happens for empty, maximum, missing, or
   concurrent input?
2. **Ripple effects** — what happens to callers and paths that were not
   modified?
3. **Rejected alternatives** — why was an existing primitive or simpler design
   not selected?
4. **Failure behavior** — what remains partially written, cached, or visible
   after an error?

## Security and privacy

- API keys and raw diffs are never written to pass records or PR bodies.
- A diff touching a `privacy.exclude` path is stopped before its contents are
  read. Codex receives an isolated snapshot with Git metadata, symlinks,
  agent-control files, and excluded paths removed; the exact bounded diff is
  supplied separately as data.
- Child processes are launched with argument arrays, never a shell string.
- Codex runs read-only and ephemerally.
- The OpenAI key is not forwarded to the Codex child process.
- Recognizable credentials, raw HTML, and GitHub mentions are blocked or
  neutralized before Q&A and summaries are written to a PR.
- Diff size and changed-file limits are configurable.
- Pass records are tied to the pushed commit, base, remote/ref, taxonomy, prompt
  version, and model.
- Amend, rebase, reset, or policy changes invalidate the record.

Codex receives repository context. GPT-5.6 receives Codex's structured analysis
and the author's Q&A, not the raw diff. Authors must still avoid putting
credentials into answers: accepted answers are intentionally saved until
`sekisyo pr` publishes the record.

Sekisyo is an accountability aid, not a security boundary. Both local records
and PR markers are editable, and `--no-verify` remains available by design.

## Architecture

```text
commands → application → domain + ports ← adapters
                                      ├─ Git / gh
                                      ├─ Codex CLI
                                      ├─ OpenAI Responses API
                                      ├─ filesystem session store
                                      └─ terminal
```

External systems are behind ports so the normal test suite uses fakes. Live
Codex, OpenAI, and GitHub checks are performed separately as manual smoke tests.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development details and
[SECURITY.md](SECURITY.md) for reporting security issues. The Japanese
[Project Story](PROJECT_STORY.md) explains the motivation, design decisions, and
current implementation. An equivalent
[English Project Story](PROJECT_STORY_EN.md) is also available.

## License

MIT
