import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { resolveContextProject, upsertContextBinding, upsertProject } from "../server/store.js";

type CliOptions = {
  baseUrl: string;
  branch?: string;
  contextKey?: string;
  createProject: boolean;
  cwd: string;
  harness: string;
  open: boolean;
  projectId?: string;
  projectName?: string;
  repoRemote?: string;
  shortcutName: string;
  tab: "overview" | "activity" | "issues";
  threadId?: string;
  writeShortcut: boolean;
};

type ProjectRecord = {
  id: string;
  name?: string;
};

type ContextResolution = {
  binding?: unknown;
  project?: ProjectRecord | null;
  url_path?: string | null;
};

const defaultBaseUrl = "http://localhost:5173";

function usage() {
  process.stdout.write(`Usage:
  npm run open:context -- [options]

Options:
  --cwd <path>              Workspace path. Defaults to the current directory.
  --harness <name>          Harness name. Defaults to codex.
  --context-key <key>       Stable context key. Defaults to <harness>:<cwd>.
  --project-id <id>         Existing Claw Task Hub project id to bind.
  --project-name <name>     Local project name to create or update when --create-project is used.
  --create-project          Create/update a local project when --project-id is omitted.
  --tab <tab>               overview, activity, or issues. Defaults to issues.
  --repo-remote <url>       Optional repository remote for future resolution.
  --branch <name>           Optional branch for future resolution.
  --thread-id <id>          Optional harness thread/session id.
  --base-url <url>          UI base URL. Defaults to ${defaultBaseUrl}.
  --open                    Open the resolved URL in the OS browser.
  --write-shortcut          Write "Open Claw Task Hub.url" in the workspace.
  --shortcut-name <name>    Shortcut filename. Defaults to "Open Claw Task Hub.url".
  --help                    Show this help.

Examples:
  npm run open:context -- --cwd C:/work/my-repo --project-id project_my_repo --write-shortcut --open
  npm run open:context -- --cwd C:/work/my-repo --project-name "My Repo" --create-project --write-shortcut --open
  npm run codex:open -- --cwd C:/work/my-repo
`);
}

function requireValue(args: string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: defaultBaseUrl,
    createProject: false,
    cwd: process.cwd(),
    harness: "codex",
    open: false,
    shortcutName: "Open Claw Task Hub.url",
    tab: "issues",
    writeShortcut: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      usage();
      process.exit(0);
    } else if (arg === "--cwd") {
      options.cwd = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--harness") {
      options.harness = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--context-key") {
      options.contextKey = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--project-id") {
      options.projectId = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--project-name") {
      options.projectName = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--create-project") {
      options.createProject = true;
    } else if (arg === "--tab") {
      const tab = requireValue(args, index, arg);
      if (!["overview", "activity", "issues"].includes(tab)) throw new Error("--tab must be overview, activity, or issues");
      options.tab = tab as CliOptions["tab"];
      index += 1;
    } else if (arg === "--repo-remote") {
      options.repoRemote = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--branch") {
      options.branch = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--thread-id") {
      options.threadId = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = requireValue(args, index, arg);
      index += 1;
    } else if (arg === "--open") {
      options.open = true;
    } else if (arg === "--write-shortcut") {
      options.writeShortcut = true;
    } else if (arg === "--shortcut-name") {
      options.shortcutName = requireValue(args, index, arg);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function normalizePath(input: string) {
  return resolve(input).replace(/\\/g, "/");
}

function slugify(input: string) {
  const slug = input.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || "workspace";
}

function shortHash(input: string) {
  return createHash("sha256").update(input).digest("hex").slice(0, 8);
}

function projectUrlPath(projectId: string, tab: CliOptions["tab"]) {
  return `/projects/${encodeURIComponent(projectId)}/${tab}`;
}

function fullUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/g, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function ensureProject(options: CliOptions, cwd: string) {
  if (options.projectId) return options.projectId;
  if (!options.createProject) return null;
  const name = options.projectName ?? basename(cwd) ?? "Codex Workspace";
  const slug = slugify(`${options.harness}-workspace-${name}`);
  const project = upsertProject({
    id: `project_${slug}_${shortHash(cwd)}`,
    external_id: `${options.harness}-workspace:${cwd}`,
    name,
    summary: "Local project created for a harness workspace launcher.",
    description: "Created by the Claw Task Hub open-context command.",
    status: "Backlog",
    priority: 3,
    source: "local",
  }) as ProjectRecord;
  return project.id;
}

function bindProject(options: CliOptions, cwd: string, contextKey: string, projectId: string) {
  return upsertContextBinding({
    context_key: contextKey,
    project_id: projectId,
    default_tab: options.tab,
    harness: options.harness,
    workspace_name: options.projectName ?? basename(cwd),
    cwd,
    repo_remote: options.repoRemote,
    branch: options.branch,
    thread_id: options.threadId,
    metadata: {
      purpose: "harness-project-launch",
      configured_by: "open-context",
    },
    source: "local",
  });
}

function resolveProject(options: CliOptions, cwd: string, contextKey: string): ContextResolution {
  return resolveContextProject({
    context_key: contextKey,
    harness: options.harness,
    cwd,
    repo_remote: options.repoRemote,
    branch: options.branch,
    thread_id: options.threadId,
  }) as ContextResolution;
}

function writeShortcut(cwd: string, shortcutName: string, url: string) {
  mkdirSync(cwd, { recursive: true });
  const shortcutPath = resolve(cwd, shortcutName);
  writeFileSync(shortcutPath, `[InternetShortcut]\r\nURL=${url}\r\n`, "utf8");
  return shortcutPath;
}

function writeMarkdownShortcut(cwd: string, url: string, projectName: string) {
  mkdirSync(cwd, { recursive: true });
  const markdownPath = resolve(cwd, "OPEN_CLAW_TASK_HUB.md");
  writeFileSync(
    markdownPath,
    `# Open Claw Task Hub\n\n` +
      `Project: ${projectName}\n\n` +
      `Open this project in Claw Task Hub:\n\n` +
      `[Open Claw Task Hub project](${url})\n\n` +
      `Use this file when your agentic harness does not show Claw Task Hub in its local app picker.\n`,
    "utf8",
  );
  return markdownPath;
}

function openUrl(url: string) {
  const command = process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}

try {
  const options = parseArgs(process.argv.slice(2));
  const cwd = normalizePath(options.cwd);
  const contextKey = options.contextKey ?? `${options.harness}:${cwd}`;
  const projectId = ensureProject(options, cwd);
  let binding: unknown = null;
  if (projectId) binding = bindProject(options, cwd, contextKey, projectId);

  const resolution = resolveProject(options, cwd, contextKey);
  const project = resolution.project;
  if (!project?.id) {
    throw new Error(
      `No Claw Task Hub project is bound to ${contextKey}. ` +
      "Pass --project-id <id> to bind an existing project, or pass --project-name <name> --create-project to create one.",
    );
  }

  const urlPath = resolution.url_path ?? projectUrlPath(project.id, options.tab);
  const url = fullUrl(options.baseUrl, urlPath);
  const shortcutPath = options.writeShortcut ? writeShortcut(cwd, options.shortcutName, url) : null;
  const shortcutMarkdownPath = options.writeShortcut ? writeMarkdownShortcut(cwd, url, project.name ?? project.id) : null;
  if (options.open) openUrl(url);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    context_key: contextKey,
    cwd,
    project,
    binding,
    url_path: urlPath,
    url,
    shortcut_path: shortcutPath,
    shortcut_markdown_path: shortcutMarkdownPath,
    opened: options.open,
  }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
}
