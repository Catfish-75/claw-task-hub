import { ensureDefaultTeam, upsertIssue, upsertProject } from "./store.js";

const team = ensureDefaultTeam() as { id: string };
const project = upsertProject({
  id: "project_claw_task_hub_mvp",
  external_id: "local:claw-task-hub-mvp",
  name: "Claw Task Hub MVP",
  summary: "Local-first task hub built for AI agents and agentic harnesses.",
  description: "Tracks local projects, issues, comments, sessions, claims, and acceptance trails without cloud issue limits.",
  status: "In Progress",
  priority: 2,
}) as { id: string };

upsertIssue({
  id: "LOCAL-1",
  external_id: "LOCAL-1",
  identifier: "LOCAL-1",
  title: "Build local task core",
  description: "SQLite WAL database, idempotent upsert model, API, and agent-oriented workflows.",
  status: "In Progress",
  status_type: "started",
  priority: 2,
  project_id: project.id,
  team_id: team.id,
  labels: ["mvp", "core"],
});

upsertIssue({
  id: "LOCAL-2",
  external_id: "LOCAL-2",
  identifier: "LOCAL-2",
  title: "Verify agent workflow docs",
  description: "Confirm the public quickstart covers project, issue, session, claim, comment, release, and close workflows.",
  status: "Backlog",
  status_type: "backlog",
  priority: 1,
  project_id: project.id,
  team_id: team.id,
  labels: ["docs", "agent-contract"],
});

console.log("Seeded Claw Task Hub MVP data.");
