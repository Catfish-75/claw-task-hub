# Changelog

All notable changes to Claw Task Hub will be documented in this file.

## 0.1.1 - 2026-10-07

- Added Linux/Omarchy desktop-menu integration and one systemd user service, with opt-in login startup.
- Added loopback-only built UI serving, bounded startup readiness, explicit shared database selection, and safe uninstall.
- Added Linux lifecycle and cross-platform desktop contract tests, plus installation and MCP documentation.
- Updated compatible dependencies and overrode the vulnerable shell-quote transitive pin; dependency audit reports no known vulnerabilities at release verification.

## 0.1.0

- Set the package version to `0.1.0` for the first public MVP release.
- Added MIT license for public release preparation.
- Kept optional Linear history import outside normal runtime as a standalone opt-in operator tool.
- Added agent session and issue claim lifecycle support for multi-agent coordination.
- Added harness smoke coverage for list, create, read, comment, session, claim, release, and close workflows.
- Added self-contained UI smoke coverage that runs against a temporary seeded database and random local ports.
- Added public quickstart, contribution, security, CI, and public hygiene checks.
- Added documentation for the optional one-off Linear history migration path.
- Set the API default bind host to loopback for local-first safety.
- Set browser date rendering to English for public UI consistency across host locales.
