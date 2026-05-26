# Launch Kit

Use this page when announcing Claw Task Hub to agent, local-first, open-source, and MCP communities. Keep every post scoped to the real v0.1.0 product: a local-first MVP for agentic task coordination, not a hosted SaaS replacement.

## Canonical Links

- Repository: https://github.com/Catfish-75/claw-task-hub
- Release: https://github.com/Catfish-75/claw-task-hub/releases/tag/v0.1.0
- Agent contract: https://github.com/Catfish-75/claw-task-hub/blob/main/docs/AGENTIC_HARNESS.md
- Security boundary: https://github.com/Catfish-75/claw-task-hub/blob/main/SECURITY.md

## Short Pitch

Claw Task Hub is a local-first, Linear-like task hub built primarily for AI agents and agentic harnesses. It gives agents deterministic project, issue, comment, session, claim, and acceptance-trail workflows over a local SQLite database, with a human-readable UI for operators.

The first public MVP is meant for local agent workflows with MCP-compatible clients, CLIs, and automation runners. It is not a hosted multi-user SaaS product, and the API binds to localhost by default.

## Long Pitch

Most task trackers are designed around humans: meetings, team rituals, manual triage, and dashboards. AI agents need a different center of gravity. They need stable identifiers, predictable status semantics, safe claim/release flows, durable comments, and acceptance trails that can survive long-running work across multiple harnesses.

Claw Task Hub is a local-first experiment in that direction. It keeps a familiar Linear-like shape for humans, but the durable contract is optimized for agents: CLI and MCP-compatible tools, SQLite persistence, local issue identifiers, agent sessions, issue claims, comments, invariant repair, and smoke tests that prove an agent can complete a full task lifecycle without touching the UI.

The v0.1.0 MVP is intentionally narrow. It runs locally, stores data in SQLite, and binds the API to localhost by default. The goal is to make agent task coordination boring, inspectable, and portable before expanding into broader workflows.

## Show HN Draft

Title:

```text
Show HN: Claw Task Hub, a local-first Linear-like task hub for AI agents
```

Body:

```text
Hi HN,

I built Claw Task Hub, a local-first, Linear-like task tracker for AI agents and agentic harnesses.

The idea is simple: many trackers are optimized for human teams, but agents need a more deterministic contract. Claw Task Hub keeps a familiar project/issue UI, while exposing agent-friendly workflows for projects, issues, comments, sessions, issue claims, claim release, and acceptance trails over a local SQLite database.

The v0.1.0 MVP is intentionally local-first:

- SQLite storage
- localhost API by default
- CLI and MCP-compatible tool surface
- Linear-like dark UI for human operators
- agent session and issue claim workflows
- smoke tests for the full agent lifecycle

Repo: https://github.com/Catfish-75/claw-task-hub
Release: https://github.com/Catfish-75/claw-task-hub/releases/tag/v0.1.0

I would especially like feedback from people running local agent harnesses and MCP-compatible automation. What task state do your agents need that human-first trackers do not model well?
```

## Reddit Draft

Title:

```text
Claw Task Hub: local-first Linear-like task tracking for AI agents
```

Body:

```text
I released the first public MVP of Claw Task Hub:

https://github.com/Catfish-75/claw-task-hub

It is a local-first, Linear-like task hub built primarily for AI agents and agentic harnesses. Humans can use the UI, but the stable contract is for agents that need deterministic task coordination:

- local SQLite database
- localhost API by default
- CLI and MCP-compatible tool surface
- project and issue tracking
- agent sessions
- issue claim/release workflow
- comments and acceptance trails

This is not a hosted SaaS product. It is meant to run locally next to MCP-compatible clients, CLIs, and other automation runners.

I am looking for feedback on the agent workflow contract: status semantics, claims, acceptance trails, and what other state agents need in order to coordinate safely.
```

Suggested communities, after checking each community's rules:

- `r/opensource`
- `r/selfhosted`
- `r/LocalLLaMA`
- `r/ClaudeAI`
- `r/github`

## Dev.to / Blog Draft

Title:

```text
Claw Task Hub: a local-first Linear-like task tracker for AI agents
```

Body:

```markdown
Most task trackers are built for humans. That makes sense: humans need dashboards, meetings, ownership, and planning views.

AI agents need those things to be readable, but they also need something more mechanical: stable identifiers, deterministic status semantics, session records, issue claims, safe release flows, and acceptance trails that other agents can inspect later.

That is the motivation behind Claw Task Hub.

Claw Task Hub is a local-first, Linear-like task hub for AI agents and agentic harnesses. The v0.1.0 MVP stores data in SQLite, exposes a CLI and MCP-compatible tool surface, binds the API to localhost by default, and includes a dark Linear-like UI for human operators.

The first release focuses on local coordination:

- projects and issues
- comments and acceptance trails
- agent sessions
- issue claim and release workflows
- invariant repair
- smoke tests for agent lifecycle behavior

It is not a hosted multi-user SaaS product. It is a local operator tool for people running MCP-compatible clients, CLIs, and agent harnesses.

Repository:

https://github.com/Catfish-75/claw-task-hub

Release:

https://github.com/Catfish-75/claw-task-hub/releases/tag/v0.1.0

I am looking for feedback from agent builders: what task state do your agents need that human-first trackers do not represent cleanly?
```

## Mastodon / X Draft

```text
Released Claw Task Hub v0.1.0: a local-first, Linear-like task hub for AI agents and agentic harnesses.

SQLite, localhost API, CLI/MCP-compatible tools, agent sessions, issue claims, comments, and acceptance trails.

Repo: https://github.com/Catfish-75/claw-task-hub
```

## LinkedIn Draft

```text
I released the first public MVP of Claw Task Hub, a local-first, Linear-like task hub built primarily for AI agents and agentic harnesses.

The premise: human-first trackers are useful, but agents need a deterministic task contract. Claw Task Hub keeps a familiar Linear-like shape while adding local SQLite storage, CLI and MCP-compatible tools, agent sessions, issue claims, comments, and acceptance trails.

The v0.1.0 release is intentionally local-first. It binds to localhost by default and is meant to run next to MCP-compatible clients, CLIs, and agent harnesses.

Repository:
https://github.com/Catfish-75/claw-task-hub

Feedback from agent builders is welcome, especially around status semantics, claim/release flows, and acceptance trails.
```

## Product Hunt Draft

Tagline:

```text
Local-first Linear-like task tracking for AI agents
```

Description:

```text
Claw Task Hub is a local-first, Linear-like task hub for AI agents and agentic harnesses. It gives agents deterministic project, issue, comment, session, claim, release, and acceptance-trail workflows over SQLite, with a familiar dark UI for human operators.
```

First comment:

```text
Claw Task Hub started from a practical problem: AI agents need a task tracker they can use directly, not just one humans can manually update after the fact.

The v0.1.0 MVP is intentionally local-first. It runs on localhost, stores data in SQLite, exposes CLI and MCP-compatible tools, and keeps normal runtime independent from external ticketing services.

I am looking for feedback from people running MCP-compatible clients, CLIs, and agentic harnesses.
```

## Community Reply Template

```text
Thanks for taking a look.

The current release is deliberately local-first: SQLite, localhost API, and no hosted multi-user assumptions. The part I most want feedback on is the agent contract: whether sessions, issue claims, comments, and acceptance trails cover the state your harness needs to coordinate work safely.

If you try it and hit a sharp edge, please open an issue with the harness, command path, expected behavior, and actual behavior:

https://github.com/Catfish-75/claw-task-hub/issues
```

## Outreach Checklist

- Publish a GitHub Discussion announcement.
- Keep the release notes concise and linked from every post.
- Post only in communities where open-source project announcements are allowed.
- Tailor the title to the community; do not cross-post identical spam.
- Ask for specific feedback from agent builders, not generic attention.
- Track every reply, issue, discussion, and bug report in the GitHub repository.
