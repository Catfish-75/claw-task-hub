# Security

## Local-First Boundary

Claw Task Hub is designed to run on a local machine. The API binds to `127.0.0.1` by default and should not be exposed to a LAN or the public internet without additional authentication, authorization, and network controls.

To bind the API to a non-loopback host, an operator must set `CLAW_TASK_HUB_UNSAFE_BIND=1`. That flag only removes the local bind guard; it does not add security controls.

## Secrets

Never store secrets in Claw Task Hub issues, comments, docs, tests, fixtures, screenshots, or sample data. This includes passwords, OAuth tokens, API keys, cookies, private keys, proxy credentials, and customer secrets.

## Reporting Vulnerabilities

For the public MVP, please open a GitHub security advisory or a private issue with:

- affected version or commit;
- exact reproduction steps;
- expected and actual behavior;
- whether the issue requires local access, LAN access, or a malicious agent/harness.

Please do not include real secrets in reports.

## Supported Scope

The first public MVP supports local development and local agent workflows. Hosted multi-user deployment, public networking, authentication, authorization, and tenant isolation are not part of the initial supported security model.
