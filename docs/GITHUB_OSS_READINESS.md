# GitHub Open-Source Readiness

This checklist is the pre-publication gate for making Claw Task Hub public on GitHub.

Claw Task Hub is intended to be a local-first task hub for agentic harnesses. Public release work must keep that product direction visible while removing local-machine assumptions and private operational data.

## Release Boundary

- Product name is `Claw Task Hub`.
- Public positioning: local-first task hub designed first for AI agents and agentic harnesses.
- Supported harness examples may include MCP-compatible clients, CLIs, and local automation runners.
- External ticketing services are not active runtime dependencies.
- Machine-specific install paths are private deployment notes, not public defaults.

## Required Before Public GitHub

- Confirm the MIT license file is present.
- Public repository target: `Catfish-75/claw-task-hub`.
- Replace private/local screenshots with sanitized examples.
- Add a sample configuration file for optional environment variables.
- Confirm that local SQLite data, logs, screenshots, temp files, and generated artifacts are ignored.
- Run a secret scan over tracked files.
- Run a path audit for machine-specific paths, private hostnames, LAN addresses, and personal names.
- Confirm README explains the agentic harness contract before UI details.
- Confirm `docs/AGENTIC_HARNESS.md` is current.
- Confirm optional external history import tools are documented as standalone operator workflows.
- Confirm the API, CLI, and MCP runtime do not expose history import tools.
- Confirm no external ticketing connection is required for install, tests, or normal use.

## Nice To Have After Publication

These should not block the first public repository if the required gate is already clean:

- packaged desktop launcher;
- richer screenshots or demo video;
- hosted documentation site;
- example harness adapters for specific tools;
- additional issue templates or discussion workflows;
- detailed architecture decision records;
- additional Linux/macOS UI smoke coverage;
- signed release artifacts.

## Data Exclusion Checklist

The public repository must not include:

- `data/*.sqlite`, WAL, SHM, or backup database files.
- local `logs/` output.
- `test-results/` screenshots unless deliberately sanitized and committed as docs assets.
- `.codex-tmp-*` scratch files.
- OAuth tokens, cookies, API keys, passwords, private SSH keys, or proxy credentials.
- customer data copied from local operational projects.

## Test Gate

Run these before any public release candidate:

```powershell
npm run build
npm run store-regression
npm run harness-smoke
npm run ui-smoke
npm run lint
npm run public-hygiene
```

The harness smoke is mandatory because it proves the core agent workflow works without the browser UI or external ticketing services.
The UI smoke is mandatory because it proves the browser flow from a temporary seeded database instead of relying on checked-in example data.

## Documentation Gate

Public docs should cover:

- install and local development commands;
- the local database path and override variables;
- the agentic harness contract;
- CLI/MCP examples for list, create, read, comment, claim, release, and close;
- status and `status_type` semantics;
- no-secret policy;
- external-history import boundary;
- optional one-off import procedure through standalone operator tools;
- pre-production test gate;
- contribution and issue-reporting expectations.
- local-only network boundary and unsafe non-loopback flag.

## Repository Hygiene

- `npm run build` must not create tracked churn outside intended build artifacts.
- `git status --short` must be clean except deliberate release files.
- Untracked local scratch files must remain untracked.
- Do not commit the live local CTH database.
- Do not commit host-specific agent, proxy, VPN, or private-network configuration.
- Do not commit user-specific names or machine-specific install paths.

## CI Candidate

The initial GitHub Actions candidate lives at `.github/workflows/ci.yml`.

It runs on `push` and `pull_request` across Windows and Linux with Node 24:

- install Node;
- run `npm ci`;
- run `npm run build`;
- run `npm run store-regression`;
- run `npm run harness-smoke`;
- run `npm run ui-smoke`;
- run `npm run lint`.
- run `npm run public-hygiene`.

`npm run ui-smoke` installs Playwright Chromium on demand and runs against an isolated temporary database, API, and Vite UI.

## Release Acceptance

The first public release candidate is acceptable when:

- all required checks above pass;
- no secrets or private operational data are tracked;
- install docs work from a fresh checkout;
- a harness can operate the task lifecycle through CLI/MCP without opening the UI;
- active work coordination is covered by sessions and claims;
- any remaining private-machine setup is clearly separated from public defaults.
