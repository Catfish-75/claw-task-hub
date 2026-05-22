import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Box,
  CheckCircle2,
  Circle,
  CircleDot,
  Clock3,
  Database,
  Flag,
  Layers,
  Link,
  ListFilter,
  MessageSquarePlus,
  MoreHorizontal,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  UserRound,
  X,
} from "lucide-react";
import "./App.css";

type Project = {
  id: string;
  name: string;
  summary?: string;
  description?: string;
  status: string;
  priority: number;
  lead?: string | null;
  issue_count: number;
};

type Issue = {
  id: string;
  identifier?: string;
  title: string;
  description?: string;
  status: string;
  status_type: string;
  priority: number;
  assignee?: string | null;
  project_id?: string;
  project_name?: string;
  team_name?: string;
  labels: string[];
  updated_at: string;
  comments?: { id: string; body: string; author: string; created_at: string }[];
};

type StatusMode = "all" | "active" | "paused" | "backlog" | "todo" | "blockers";

type ActivityEvent = {
  id: string;
  identifier?: string;
  title: string;
  status: string;
  status_type: string;
  priority: number;
  updated_at: string;
  type: "issue" | "comment";
  verb: "completed" | "started" | "blocker" | "updated" | "commented";
  author?: string;
  body?: string;
};

type ProjectDetail = {
  project: Project;
  counts: { total: number; done: number; started: number; open: number; blockers: number };
  statusCounts: { status: string; status_type: string; count: number }[];
  priorityCounts: { priority: number; count: number }[];
  issues: Issue[];
  activity: ActivityEvent[];
};

type Dashboard = {
  counts: { projects: number; issues: number; done: number; active: number };
  byStatus: { status: string; count: number }[];
  recent: Issue[];
};

const apiBase = import.meta.env.VITE_CLAW_TASK_HUB_API_BASE ?? "http://127.0.0.1:4781/api";
const displayDateLocale = "en-US";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspaceIssues, setWorkspaceIssues] = useState<Issue[]>([]);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [page, setPage] = useState<"projects" | "workspace" | "project">("projects");
  const [tab, setTab] = useState<"overview" | "activity" | "issues">("overview");
  const [query, setQuery] = useState("");
  const [statusMode, setStatusMode] = useState<StatusMode>("all");
  const [creating, setCreating] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const pageRef = useRef<"projects" | "workspace" | "project">("projects");
  const projectDetailRef = useRef<ProjectDetail | null>(null);
  const selectedIssueRef = useRef<Issue | null>(null);
  const refreshInFlightRef = useRef(false);
  const lastRefreshStartedAtRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    pageRef.current = page;
  }, [page]);

  useEffect(() => {
    projectDetailRef.current = projectDetail;
  }, [projectDetail]);

  useEffect(() => {
    selectedIssueRef.current = selectedIssue;
  }, [selectedIssue]);

  const refresh = useCallback(async (force = false) => {
    if (refreshInFlightRef.current) return;
    const startedAt = Date.now();
    if (!force && startedAt - lastRefreshStartedAtRef.current < 1200) return;
    lastRefreshStartedAtRef.current = startedAt;
    refreshInFlightRef.current = true;
    const snapshot = {
      page: pageRef.current,
      projectId: projectDetailRef.current?.project.id,
      issueId: selectedIssueRef.current?.id,
    };
    try {
      const [dash, proj, issueList, detail, selected] = await Promise.all([
      api<Dashboard>("/dashboard"),
      api<{ projects: Project[] }>("/projects"),
      api<{ issues: Issue[] }>("/issues?limit=250"),
      snapshot.page === "project" && snapshot.projectId ? api<ProjectDetail>(`/projects/${encodeURIComponent(snapshot.projectId)}`) : Promise.resolve(null),
      snapshot.issueId ? api<{ issue: Issue }>(`/issues/${encodeURIComponent(snapshot.issueId)}`).catch(() => null) : Promise.resolve(null),
      ]);
      void dash;
      setProjects(proj.projects);
      setWorkspaceIssues(issueList.issues);
      const samePage = pageRef.current === snapshot.page;
      const sameProject = projectDetailRef.current?.project.id === snapshot.projectId;
      const sameIssueContext = samePage && (snapshot.page !== "project" || sameProject);
      if (detail && samePage && sameProject) setProjectDetail(detail);
      if (selected?.issue && sameIssueContext && selectedIssueRef.current?.id === snapshot.issueId) setSelectedIssue(selected.issue);
      else if (snapshot.issueId && detail && sameIssueContext && selectedIssueRef.current?.id === snapshot.issueId) {
        setSelectedIssue(detail.issues.find((issue) => issue.id === snapshot.issueId) ?? detail.issues[0] ?? null);
      }
    } finally {
      refreshInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    const schedule = () => {
      refreshTimerRef.current = window.setTimeout(async () => {
        if (document.visibilityState === "visible") await refresh();
        schedule();
      }, 2000);
    };
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    schedule();
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current);
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [refresh]);

  async function openProject(project: Project, nextTab: "overview" | "activity" | "issues" = "overview") {
    const detail = await api<ProjectDetail>(`/projects/${encodeURIComponent(project.id)}`);
    setProjectDetail(detail);
    setSelectedIssue(detail.issues[0] ?? null);
    setPage("project");
    setTab(nextTab);
    setQuery("");
    setStatusMode("all");
  }

  async function openIssue(issue: Issue, reveal = false) {
    const detail = await api<{ issue: Issue }>(`/issues/${encodeURIComponent(issue.id)}`);
    setSelectedIssue(detail.issue);
    if (reveal) setDetailOpen(true);
  }

  async function createIssue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    if (!title) return;
    setCreating(true);
    try {
      const created = await api<{ issue: Issue }>("/issues", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: String(data.get("description") ?? ""),
          project_id: projectDetail?.project.id ?? projects[0]?.id,
          status: "Backlog",
          status_type: "backlog",
          priority: Number(data.get("priority") ?? 3),
          labels: ["local"],
        }),
      });
      form.reset();
      await refresh();
      await openIssue(created.issue);
      setTab("issues");
    } finally {
      setCreating(false);
    }
  }

  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIssue) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const body = String(data.get("body") ?? "").trim();
    if (!body) return;
    await api(`/issues/${encodeURIComponent(selectedIssue.id)}/comments`, {
      method: "POST",
      body: JSON.stringify({ body, author: "Agent" }),
    });
    form.reset();
    await openIssue(selectedIssue);
  }

  const activeIssues = projectDetail?.issues ?? workspaceIssues;
  const filteredIssues = useMemo(() => {
    const lower = query.trim().toLowerCase();
    return activeIssues.filter((issue) => {
      const text = `${issue.identifier ?? ""} ${issue.title} ${issue.description ?? ""}`.toLowerCase();
      const matchesText = !lower || text.includes(lower);
      const statusType = resolveUiStatusType(issue);
      const matchesMode =
        statusMode === "all" ||
        (statusMode === "active" && ["started", "blocked", "paused"].includes(statusType)) ||
        (statusMode === "paused" && statusType === "paused") ||
        (statusMode === "backlog" && statusType === "backlog") ||
        (statusMode === "todo" && statusType === "unstarted") ||
        (statusMode === "blockers" && issue.priority === 1 && statusType !== "completed");
      return matchesText && matchesMode;
    });
  }, [activeIssues, query, statusMode]);

  return (
    <main className="linear-shell">
      <TopChrome />
      <section className="linear-page">
        <HeaderBar
          page={page}
          tab={tab}
          project={projectDetail?.project}
          onProjects={() => {
            setPage("projects");
            setProjectDetail(null);
            setSelectedIssue(null);
          }}
          onWorkspace={() => {
            setPage("workspace");
            setProjectDetail(null);
            setSelectedIssue(workspaceIssues[0] ?? null);
            setTab("issues");
          }}
          onTab={setTab}
        />

        {page === "projects" ? (
          <ProjectsPage projects={projects} onOpenProject={openProject} />
        ) : page === "workspace" ? (
          <IssuesPage
            title="All issues"
            issues={filteredIssues}
            selectedIssue={selectedIssue}
            query={query}
            statusMode={statusMode}
            creating={creating}
            onQuery={setQuery}
            onStatusMode={setStatusMode}
            onCreate={createIssue}
            onOpenIssue={openIssue}
            onAddComment={addComment}
          />
        ) : tab === "overview" && projectDetail ? (
          <ProjectOverview detail={projectDetail} onTab={setTab} />
        ) : tab === "activity" && projectDetail ? (
          <ProjectActivity detail={projectDetail} />
        ) : projectDetail ? (
          <IssuesPage
            title={projectDetail.project.name}
            issues={filteredIssues}
            selectedIssue={selectedIssue}
            query={query}
            statusMode={statusMode}
            creating={creating}
            onQuery={setQuery}
            onStatusMode={setStatusMode}
            onCreate={createIssue}
            onOpenIssue={openIssue}
            onAddComment={addComment}
          />
        ) : null}
      </section>
      <footer className="askbar">Ask Claw Task Hub</footer>
      {detailOpen && selectedIssue ? (
        <IssueDialog issue={selectedIssue} onClose={() => setDetailOpen(false)} onAddComment={addComment} />
      ) : null}
    </main>
  );
}

function TopChrome() {
  return (
    <header className="top-chrome">
      <div className="window-tab">
        <Database size={15} />
        <span>clawtaskhub</span>
      </div>
      <button className="ghost-icon"><Plus size={16} /></button>
      <div className="address">{window.location.host || "localhost:5173"}</div>
      <button className="ghost-icon"><Activity size={16} /></button>
      <button className="ghost-icon"><MoreHorizontal size={17} /></button>
    </header>
  );
}

function HeaderBar({
  page,
  tab,
  project,
  onProjects,
  onWorkspace,
  onTab,
}: {
  page: "projects" | "workspace" | "project";
  tab: "overview" | "activity" | "issues";
  project?: Project;
  onProjects: () => void;
  onWorkspace: () => void;
  onTab: (tab: "overview" | "activity" | "issues") => void;
}) {
  const showProjectTabs = page === "project";
  return (
    <>
      <div className="crumbbar">
        <button className="crumb-icon"><Layers size={15} /></button>
        {page === "projects" ? (
          <strong>Projects</strong>
        ) : page === "workspace" ? (
          <strong>Issues</strong>
        ) : (
          <>
            <button onClick={onProjects}>Projects</button>
            <span>›</span>
            <strong>{project?.name}</strong>
          </>
        )}
        <button className="ghost-icon"><Star size={15} /></button>
        <button className="ghost-icon"><MoreHorizontal size={17} /></button>
        <div className="crumb-actions">
          <button className="ghost-icon"><Link size={15} /></button>
          <button className="ghost-icon"><Bell size={15} /></button>
          <button className="ghost-icon"><Plus size={16} /></button>
        </div>
      </div>

      <div className="view-tabs">
        {page === "projects" ? (
          <button className="pill active">All projects</button>
        ) : page === "workspace" ? (
          <>
            <button className="pill active">Active</button>
            <button className="pill" onClick={onWorkspace}>All issues</button>
            <button className="pill">Backlog</button>
          </>
        ) : showProjectTabs ? (
          <>
            <button className={tab === "overview" ? "pill active" : "pill"} onClick={() => onTab("overview")}>Overview</button>
            <button className={tab === "activity" ? "pill active" : "pill"} onClick={() => onTab("activity")}>Activity</button>
            <button className={tab === "issues" ? "pill active" : "pill"} onClick={() => onTab("issues")}>Issues</button>
          </>
        ) : null}
        <button className="stack-icon"><Layers size={14} /></button>
        <div className="view-tools">
          <button className="round-icon"><ListFilter size={15} /></button>
          <button className="round-icon"><SlidersHorizontal size={15} /></button>
        </div>
      </div>
    </>
  );
}

function ProjectsPage({ projects, onOpenProject }: { projects: Project[]; onOpenProject: (project: Project) => void }) {
  return (
    <section className="projects-screen">
      <div className="projects-table">
        <div className="project-row project-head">
          <span>Name</span>
          <span>Health</span>
          <span>Priority</span>
          <span>Lead</span>
          <span>Target date</span>
          <span>Issues</span>
          <span>Status</span>
        </div>
        {projects.map((project) => (
          <button key={project.id} className="project-row" onClick={() => onOpenProject(project)}>
            <span className="project-name"><ProjectIcon project={project} /> {project.name}</span>
            <span><Circle className="dim" size={15} /></span>
            <span><PriorityBars priority={project.priority} /></span>
            <span>{project.lead ? <Avatar label={project.lead} /> : <UserRound className="dim" size={16} />}</span>
            <span className="dim">Target date</span>
            <strong>{project.issue_count}</strong>
            <span><StatusIcon statusType={project.status === "Done" ? "completed" : "started"} /></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProjectOverview({ detail, onTab }: { detail: ProjectDetail; onTab: (tab: "overview" | "activity" | "issues") => void }) {
  const project = detail.project;
  const topResources = detail.issues.slice(0, 16);
  return (
    <section className="project-overview-linear">
      <div className="project-hero">
        <ProjectIcon project={project} large />
        <h1>{project.name}</h1>
        <p>{project.summary || project.description || "Browse every local issue imported from history or created by agents."}</p>
      </div>

      <div className="properties-row">
        <span className="prop-label">Properties</span>
        <StatusPill status={project.status || "In Progress"} statusType={project.status === "Done" ? "completed" : "started"} />
        <span className="prop-item"><PriorityBars priority={project.priority} /> {priorityName(project.priority)}</span>
        <span className="prop-item"><Avatar label={project.lead || "Unassigned"} /> {project.lead || "Unassigned"}</span>
        <span className="prop-item">Apr 2026 -&gt; Target date</span>
        <span className="prop-item"><Box size={14} /> Local workspace</span>
      </div>

      <div className="resources-row">
        <span className="prop-label">Resources</span>
        <div className="resource-list">
          {topResources.map((issue) => (
            <button key={issue.id} onClick={() => onTab("issues")}>
              <span>{resourceIcon(issue)}</span>
              <span>{issueCode(issue)} {issue.title}</span>
            </button>
          ))}
          <button className="add-resource"><Plus size={14} /> Add resource</button>
        </div>
      </div>

      <button className="update-box" onClick={() => onTab("activity")}>
        <MessageSquarePlus size={16} />
        <span>Write first project update</span>
      </button>
    </section>
  );
}

function ProjectActivity({ detail }: { detail: ProjectDetail }) {
  return (
    <section className="activity-linear">
      <div className="update-composer">
        <div className="composer-tabs">
          <span>Comment</span>
          <strong>Update</strong>
          <em>On track</em>
        </div>
        <p>Write a project update...</p>
        <div className="composer-props">
          <span>Priority</span><strong>No priority -&gt; {priorityName(detail.project.priority)}</strong>
          <span>Lead</span><strong><Avatar label={detail.project.lead || "Unassigned"} /> {detail.project.lead || "Unassigned"}</strong>
          <span>Progress</span><strong>{detail.counts.done} done / {detail.counts.started} in progress / {detail.counts.open} open</strong>
        </div>
        <button disabled>Post update</button>
      </div>
      <div className="timeline">
        {detail.activity.map((event) => (
          <div key={`${event.id}-${event.updated_at}`} className="timeline-row">
            <StatusIcon statusType={event.status_type} />
            <span>{activityText(event)} / {formatDate(event.updated_at)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function IssuesPage({
  title,
  issues,
  selectedIssue,
  query,
  statusMode,
  creating,
  onQuery,
  onStatusMode,
  onCreate,
  onOpenIssue,
  onAddComment,
}: {
  title: string;
  issues: Issue[];
  selectedIssue: Issue | null;
  query: string;
  statusMode: StatusMode;
  creating: boolean;
  onQuery: (value: string) => void;
  onStatusMode: (mode: StatusMode) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onOpenIssue: (issue: Issue, reveal?: boolean) => void;
  onAddComment: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const grouped = groupIssues(issues);
  return (
    <section className="issues-screen">
      <div className="issue-filter-row">
        <div className="searchbar"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={`Search ${title}`} /></div>
        <button className="round-icon"><ListFilter size={15} /></button>
        <button className="round-icon"><SlidersHorizontal size={15} /></button>
      </div>
      <div className="mode-row">
        <button className={statusMode === "blockers" ? "mode-chip danger active" : "mode-chip danger"} onClick={() => onStatusMode("blockers")}><AlertTriangle size={14} />Blockers</button>
        <button className={statusMode === "all" ? "mode-chip active" : "mode-chip"} onClick={() => onStatusMode("all")}>All statuses</button>
        <button className={statusMode === "active" ? "mode-chip active" : "mode-chip"} onClick={() => onStatusMode("active")}>Active</button>
        <button className={statusMode === "paused" ? "mode-chip active" : "mode-chip"} onClick={() => onStatusMode("paused")}>Paused</button>
        <button className={statusMode === "backlog" ? "mode-chip active" : "mode-chip"} onClick={() => onStatusMode("backlog")}>Backlog</button>
        <button className={statusMode === "todo" ? "mode-chip active" : "mode-chip"} onClick={() => onStatusMode("todo")}>Todo</button>
      </div>
      <form className="linear-create" onSubmit={onCreate}>
        <Plus size={16} />
        <input name="title" placeholder={`New issue in ${title}`} />
        <select name="priority" defaultValue="3"><option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="4">P4</option></select>
        <input name="description" placeholder="Short note" />
        <button disabled={creating}>{creating ? "Saving" : "Add"}</button>
      </form>
      <div className="issues-and-detail">
        <div className="linear-issue-list">
          {grouped.length === 0 ? (
            <div className="empty-list">No issues found</div>
          ) : grouped.map((group) => (
            <div key={group.key} className="issue-group">
              <div className="group-head"><span>⌄</span><StatusIcon statusType={group.statusType} /><strong>{group.label}</strong><em>{group.items.length}</em><button><Plus size={14} /></button></div>
              {group.items.map((issue) => {
                const statusType = resolveUiStatusType(issue);
                return (
                  <button
                    key={issue.id}
                    className={selectedIssue?.id === issue.id ? "linear-issue-row active" : "linear-issue-row"}
                    onClick={() => onOpenIssue(issue)}
                    onDoubleClick={() => onOpenIssue(issue, true)}
                  >
                    <PriorityBars priority={issue.priority} />
                    <span className="issue-id">{issueCode(issue)}</span>
                    <StatusIcon statusType={statusType} />
                    <strong>{issue.title}</strong>
                    <span className="relation">{issue.project_name}</span>
                    <span className="assignee"><UserRound size={15} /></span>
                    <time>{formatShortDate(issue.updated_at)}</time>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <IssueDetail issue={selectedIssue} onAddComment={onAddComment} />
      </div>
    </section>
  );
}

function IssueDetail({ issue, onAddComment }: { issue: Issue | null; onAddComment: (event: FormEvent<HTMLFormElement>) => void }) {
  if (!issue) return <aside className="issue-detail empty-detail">Select an issue</aside>;
  return (
    <aside className="issue-detail">
      <div className="detail-top"><span>{issueCode(issue)}</span><StatusPill status={issue.status} statusType={resolveUiStatusType(issue)} /></div>
      <h2>{issue.title}</h2>
      <div className="detail-pills"><PriorityPill priority={issue.priority} /><span>{issue.project_name}</span><span>{issue.team_name}</span></div>
      <p>{issue.description || "No description yet."}</p>
      <div className="comments-box">
        <strong>Activity</strong>
        {issue.comments?.map((comment) => <article key={comment.id}><b>{comment.author}</b><span>{comment.body}</span></article>)}
        <form onSubmit={onAddComment}><input name="body" placeholder="Add an agent note" /><button>Add</button></form>
      </div>
    </aside>
  );
}

function IssueDialog({ issue, onClose, onAddComment }: { issue: Issue; onClose: () => void; onAddComment: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <div className="issue-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="issue-dialog" role="dialog" aria-modal="true" aria-labelledby="issue-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" onClick={onClose} aria-label="Close issue detail"><X size={16} /></button>
        <div className="detail-top"><span>{issueCode(issue)}</span><StatusPill status={issue.status} statusType={resolveUiStatusType(issue)} /></div>
        <h2 id="issue-dialog-title">{issue.title}</h2>
        <div className="detail-pills"><PriorityPill priority={issue.priority} /><span>{issue.project_name}</span><span>{issue.team_name}</span></div>
        <p>{issue.description || "No description yet."}</p>
        <div className="comments-box">
          <strong>Activity</strong>
          {issue.comments?.map((comment) => <article key={comment.id}><b>{comment.author}</b><span>{comment.body}</span></article>)}
          <form onSubmit={onAddComment}><input name="body" placeholder="Add an agent note" /><button>Add</button></form>
        </div>
      </section>
    </div>
  );
}

function issueCode(issue: Pick<Issue, "identifier" | "id">) {
  return issue.identifier || issue.id;
}

function groupIssues(issues: Issue[]) {
  const order = [
    ["started", "In Progress"],
    ["blocked", "Blocked"],
    ["paused", "Paused"],
    ["backlog", "Backlog"],
    ["unstarted", "Todo"],
    ["completed", "Done"],
  ];
  return order
    .map(([statusType, label]) => ({
      key: statusType,
      statusType,
      label,
      items: issues.filter((issue) => {
        const resolved = resolveUiStatusType(issue);
        return resolved === statusType;
      }),
    }))
    .filter((group) => group.items.length);
}

function resolveUiStatusType(issue: Pick<Issue, "status" | "status_type">) {
  const status = issue.status.trim().toLowerCase();
  if (["done", "completed"].includes(status)) return "completed";
  if (["in progress", "started"].includes(status)) return "started";
  if (["todo", "to do"].includes(status)) return "unstarted";
  if (["blocked", "blocker"].includes(status)) return "blocked";
  if (["paused", "pause"].includes(status)) return "paused";
  if (["canceled", "cancelled"].includes(status)) return "canceled";
  return issue.status_type;
}

function ProjectIcon({ project, large }: { project: Project; large?: boolean }) {
  const status = project.status.trim().toLowerCase();
  const icon = status === "done" || status === "completed" ? "✓" : status === "paused" ? "◷" : "◇";
  return <span className={large ? "project-icon large" : "project-icon"}>{icon}</span>;
}

function StatusIcon({ statusType }: { statusType: string }) {
  if (statusType === "completed") return <CheckCircle2 className="sicon done" size={16} />;
  if (statusType === "blocked") return <AlertTriangle className="sicon blocker" size={16} />;
  if (statusType === "started") return <Clock3 className="sicon started" size={16} />;
  if (statusType === "paused") return <CircleDot className="sicon paused" size={16} />;
  if (statusType === "backlog") return <Circle className="sicon backlog" size={16} />;
  return <CircleDot className="sicon todo" size={16} />;
}

function StatusPill({ status, statusType }: { status: string; statusType: string }) {
  return <span className={`status-pill ${statusType}`}><StatusIcon statusType={statusType} />{status}</span>;
}

function PriorityPill({ priority }: { priority: number }) {
  return <span className={`priority p${priority}`}><Flag size={13} />P{priority}</span>;
}

function PriorityBars({ priority }: { priority: number }) {
  return <span className={`pbars p${priority}`}><i /><i /><i /></span>;
}

function Avatar({ label }: { label: string }) {
  return <span className="avatar">{label.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>;
}

function priorityName(priority: number) {
  if (priority === 1) return "Urgent";
  if (priority === 2) return "High";
  if (priority === 4) return "Low";
  return "Medium";
}

function resourceIcon(issue: Issue) {
  if (issue.priority === 1) return "🚨";
  if (issue.status_type === "completed") return "📄";
  if (issue.status_type === "started") return "📊";
  return "▰";
}

function activityText(event: ActivityEvent) {
  if (event.type === "comment") return `${event.author || "Agent"} commented`;
  if (event.verb === "completed") return `${event.identifier} completed`;
  if (event.verb === "started") return `${event.identifier} moved to In Progress`;
  if (event.verb === "blocker") return `${event.identifier} marked blocker`;
  return `${event.identifier} updated`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat(displayDateLocale, { month: "short", day: "numeric" }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(displayDateLocale, { month: "long", day: "numeric" }).format(new Date(value));
}

export default App;
