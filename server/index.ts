import cors from "cors";
import express from "express";
import { z } from "zod";
import { dbPath } from "./db.js";
import { dashboard, ensureDefaultTeam, getIssue, getProject, listIssues, listProjects, listTeams, recentSyncRuns, saveComment, upsertIssue, upsertProject } from "./store.js";

ensureDefaultTeam();

const app = express();

const port = Number(process.env.PORT ?? 4781);
const host = process.env.CLAW_TASK_HUB_HOST ?? "127.0.0.1";
const unsafeBind = process.env.CLAW_TASK_HUB_UNSAFE_BIND === "1";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHost(value: string) {
  return loopbackHosts.has(value) || value.startsWith("127.");
}

if (!isLoopbackHost(host) && !unsafeBind) {
  console.error(`Refusing to bind Claw Task Hub API to ${host}. Set CLAW_TASK_HUB_UNSAFE_BIND=1 only for an explicitly secured non-local deployment.`);
  process.exit(1);
}

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://[::1]:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://[::1]:4173",
  ...String(process.env.CLAW_TASK_HUB_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

app.use(cors({
  origin(origin, callback) {
    if (!origin || unsafeBind || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS origin not allowed: ${origin}`));
  },
}));
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, dbPath, mode: "local", host, linear: "retired" });
});

app.get("/api/dashboard", (_req, res) => res.json(dashboard()));
app.get("/api/sync-runs", (_req, res) => res.json({ runs: recentSyncRuns() }));
app.get("/api/teams", (_req, res) => res.json({ teams: listTeams() }));
app.get("/api/projects", (_req, res) => res.json({ projects: listProjects() }));
app.get("/api/projects/:id", (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
});

app.post("/api/projects", (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    summary: z.string().optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
  });
  res.json({ project: upsertProject(schema.parse(req.body)) });
});

app.get("/api/issues", (req, res) => {
  res.json({
    issues: listIssues({
      project: req.query.project as string | undefined,
      project_id: req.query.project_id as string | undefined,
      team: req.query.team as string | undefined,
      team_id: req.query.team_id as string | undefined,
      status: req.query.status as string | undefined,
      status_type: req.query.status_type as string | undefined,
      include_done: req.query.include_done as string | undefined,
      query: req.query.query as string | undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
      offset: req.query.offset ? Number(req.query.offset) : undefined,
    }),
  });
});

app.get("/api/issues/:id", (req, res) => {
  const issue = getIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: "Issue not found" });
  res.json({ issue });
});

app.post("/api/issues", (req, res) => {
  const schema = z.object({
    id: z.string().optional(),
    external_id: z.string().optional(),
    identifier: z.string().optional(),
    issue_id: z.string().optional(),
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.string().optional(),
    status_type: z.string().optional(),
    priority: z.number().int().min(0).max(4).optional(),
    project_id: z.string().nullable().optional(),
    allow_no_project: z.boolean().optional(),
    team_id: z.string().nullable().optional(),
    assignee: z.string().nullable().optional(),
    labels: z.array(z.string()).optional(),
  }).superRefine((value, ctx) => {
    if (!value.id && !value.external_id && !value.identifier && !value.issue_id && !value.title) {
      ctx.addIssue({ code: "custom", path: ["title"], message: "title is required when creating an issue" });
    }
  });
  try {
    res.json({ issue: upsertIssue(schema.parse(req.body)) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/issues/:id/comments", (req, res) => {
  const issue = getIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: "Issue not found" });
  const schema = z.object({ body: z.string().min(1), author: z.string().optional() });
  res.json({ comment: saveComment({ ...schema.parse(req.body), issue_id: (issue as unknown as { id: string }).id }) });
});

app.listen(port, host, () => {
  console.log(`Claw Task Hub API listening on http://${host}:${port}`);
});
