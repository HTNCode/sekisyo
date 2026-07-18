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

PR write-back rejects recognizable credentials and neutralizes raw HTML and
GitHub mentions, but this is a defense-in-depth heuristic rather than a complete
secret scanner. Do not put credentials into oral-examination answers because
accepted answers are temporarily stored locally before publication.
