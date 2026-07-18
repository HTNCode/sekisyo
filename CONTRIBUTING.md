# Contributing

Thank you for helping authors become stronger before their work reaches review.

## Principles

- Optimize for author understanding first.
- Ask questions that require evidence from the actual change.
- Never infer authorship from writing style.
- Keep bypasses explicit and auditable instead of pretending the local hook is
  an enforcement boundary.
- Preserve existing Git hooks and PR prose.

## Local checks

Use Bun:

```bash
bun install
bun run typecheck
bun run lint
bun run format:check
bun test
bun run build
```

Do not commit `.env.local`, pass records, raw diffs, API responses, or other
credentials.

## Structure

- `src/domain`: pure types, policies, fingerprints, and state transitions
- `src/ports`: external-system boundaries
- `src/application`: use cases
- `src/adapters`: Git, Codex, OpenAI, GitHub, filesystem, and terminal adapters
- `src/commands`: CLI commands
- `test/unit`: pure and adapter tests with fakes
- `test/integration`: temporary Git repository tests

Keep changes atomic and use conventional prefixes such as `feat:`, `fix:`,
`test:`, and `docs:`.
