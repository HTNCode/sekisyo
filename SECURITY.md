# Security Policy

## Reporting

Please report vulnerabilities privately through GitHub Security Advisories. Do
not include API keys, private diffs, oral-examination answers, or repository
credentials in a public issue.

## Trust model

Sekisyo is not a security or identity boundary.

- `git push --no-verify` bypasses the local gate by design.
- A user with local filesystem access can edit pass records.
- A contributor can manually edit the PR marker.
- AI judgments can be wrong.

The included CI check only verifies that a single well-formed Sekisyo block
names the current PR head. It does not cryptographically prove who answered or
whether an answer is true.

## Data handling

Sekisyo sends repository-derived analysis to OpenAI. Configure exclusions for
sensitive paths. A changed excluded path blocks analysis before its contents are
read. Codex receives an isolated snapshot with Git metadata, symlinks,
agent-control files, and excluded paths removed. Raw API keys and raw diffs must
never be stored in local pass records or PR bodies.

Child `git` and `gh` processes do not receive OpenAI environment variables
(`OPENAI_API_KEY`, `OPENAI_BASE_URL`, and the organization and project
variables). This is a minimal denylist, not a full sanitizer: other secrets in
the invoking shell, such as cloud or registry tokens, are still inherited. The
`sekisyo git` passthrough also still hands the environment to Git unchanged;
tightening it is tracked separately.

The local record directory is kept at mode `0o700`, and an existing directory
with a different mode is tightened on each save. This relies on POSIX
permissions and has no effect on Windows.

PR write-back rejects recognizable credentials and neutralizes raw HTML and
GitHub mentions, but this is a defense-in-depth heuristic rather than a complete
secret scanner. In particular, the generic `name = value` check only treats a
value as a credential when it is entirely ASCII or contains a run of at least
eight printable ASCII characters, so a short value or a space-separated
passphrase mixed with non-ASCII prose can slip through. Do not put credentials
into oral-examination answers because accepted answers are temporarily stored
locally before publication.
