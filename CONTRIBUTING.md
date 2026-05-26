# Contributing

Thank you for helping improve Claw Task Hub.

## Product Direction

Claw Task Hub is local-first and agent-first. Human readability matters, but every change should preserve deterministic workflows for AI agents and agentic harnesses.

Good contributions improve one or more of these areas:

- reliable CLI and MCP tool behavior;
- issue/session/claim coordination for multiple agents;
- local SQLite durability and upgrade safety;
- clear agent-facing documentation;
- Linear-like UI clarity without turning the app into a hosted service by default.

## Development Setup

```powershell
npm ci
npm run dev
```

The UI runs at `http://localhost:5173`. The API listens on `127.0.0.1:4781` by default.

## Required Checks

Run these before opening a pull request:

```powershell
npm run build
npm run lint
npm run store-regression
npm run harness-smoke
npm run ui-smoke
npm run public-hygiene
```

`ui-smoke` uses a temporary seeded database and local ports so it can run from a fresh checkout. Its first run may download the Playwright Chromium browser.

## Pull Request Guidelines

- Keep changes scoped and reviewable.
- Add or update tests for behavior changes.
- Update docs when tool contracts, status semantics, startup behavior, or security boundaries change.
- Use concise issue titles and detailed descriptions or comments.
- Preserve local-first defaults.

## Public Hygiene

Do not commit:

- SQLite databases, WAL/SHM files, logs, screenshots, generated reports, or scratch files;
- passwords, API keys, OAuth tokens, cookies, private keys, or proxy credentials;
- machine-specific paths, private LAN addresses, user names, or customer data;
- text that is not appropriate for a public repository.

Run `npm run public-hygiene` before publishing or opening a pull request.

## External Import Boundary

External tracker import code is retained only for explicit operator-run history imports. Normal work must not connect to external ticketing services or expose import tools in the standard tool list.
