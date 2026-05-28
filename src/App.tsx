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
  external_id?: string | null;
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
  active_claim_count?: number;
  active_claim_agent?: string | null;
  active_claim_harness?: string | null;
  active_claims?: IssueClaim[];
  last_acceptance_at?: string | null;
  last_acceptance_comment?: IssueComment | null;
  comments?: IssueComment[];
};

type IssueComment = { id: string; body: string; author: string; created_at: string };

type IssueClaim = {
  id: string;
  session_id: string;
  agent_name: string;
  harness?: string | null;
  note?: string | null;
  claimed_at?: string;
  expires_at: string;
};

type StatusMode = "all" | "active" | "paused" | "backlog" | "todo" | "blockers";
type IssueDisplayLimit = "50" | "100" | "200" | "all";
type IssueStatusType = "started" | "blocked" | "paused" | "backlog" | "unstarted" | "completed" | "canceled";

type ApiIssueGroup = {
  key: string;
  status_type: IssueStatusType;
  label: string;
  total: number;
  returned: number;
  truncated: boolean;
  issues: Issue[];
};

type UiIssueGroup = {
  key: string;
  statusType: IssueStatusType;
  label: string;
  total: number;
  returned: number;
  truncated: boolean;
  items: Issue[];
};

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
  issueGroups?: ApiIssueGroup[];
  issueDisplayLimit?: IssueDisplayLimit;
  activity: ActivityEvent[];
};

type Dashboard = {
  counts: { projects: number; issues: number; done: number; active: number };
  byStatus: { status: string; count: number }[];
  recent: Issue[];
};

const apiBase = import.meta.env.VITE_CLAW_TASK_HUB_API_BASE ?? "http://127.0.0.1:4781/api";
const displayDateLocale = "en-US";
const defaultIssueDisplayLimit: IssueDisplayLimit = "50";

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
  const [workspaceIssueGroups, setWorkspaceIssueGroups] = useState<ApiIssueGroup[]>([]);
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [serverSearchResult, setServerSearchResult] = useState<{ scope: string; query: string; issues: Issue[] } | null>(null);
  const [page, setPage] = useState<"projects" | "workspace" | "project">("projects");
  const [tab, setTab] = useState<"overview" | "activity" | "issues">("overview");
  const [query, setQuery] = useState("");
  const [statusMode, setStatusMode] = useState<StatusMode>("all");
  const [issueDisplayLimit, setIssueDisplayLimit] = useState<IssueDisplayLimit>(defaultIssueDisplayLimit);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const pageRef = useRef<"projects" | "workspace" | "project">("projects");
  const issueDisplayLimitRef = useRef<IssueDisplayLimit>(defaultIssueDisplayLimit);
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

  useEffect(() => {
    issueDisplayLimitRef.current = issueDisplayLimit;
  }, [issueDisplayLimit]);

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
      issueDisplayLimit: issueDisplayLimitRef.current,
    };
    try {
      const [dash, proj, issueList, detail, selected] = await Promise.all([
      api<Dashboard>("/dashboard"),
      api<{ projects: Project[] }>("/projects"),
      api<{ issues: Issue[]; issueGroups?: ApiIssueGroup[] }>(`/issues?per_status_limit=${encodeURIComponent(snapshot.issueDisplayLimit)}`),
      snapshot.page === "project" && snapshot.projectId
        ? api<ProjectDetail>(`/projects/${encodeURIComponent(snapshot.projectId)}?issues_per_status=${encodeURIComponent(snapshot.issueDisplayLimit)}`)
        : Promise.resolve(null),
      snapshot.issueId ? api<{ issue: Issue }>(`/issues/${encodeURIComponent(snapshot.issueId)}`).catch(() => null) : Promise.resolve(null),
      ]);
      void dash;
      setProjects(proj.projects);
      setWorkspaceIssues(issueList.issues);
      setWorkspaceIssueGroups(issueList.issueGroups ?? []);
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

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const projectId = page === "project" ? projectDetail?.project.id : undefined;
    const scope = `${page}:${projectId ?? ""}`;
    const params = new URLSearchParams({ query: trimmed, limit: "250" });
    if (projectId) params.set("project_id", projectId);
    let cancelled = false;
    api<{ issues: Issue[] }>(`/issues?${params.toString()}`)
      .then((result) => {
        if (!cancelled) setServerSearchResult({ scope, query: trimmed, issues: result.issues });
      })
      .catch(() => {
        if (!cancelled) setServerSearchResult({ scope, query: trimmed, issues: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [page, projectDetail?.project.id, query]);

  async function openProject(project: Project, nextTab: "overview" | "activity" | "issues" = "overview") {
    const detail = await api<ProjectDetail>(`/projects/${encodeURIComponent(project.id)}?issues_per_status=${encodeURIComponent(issueDisplayLimitRef.current)}`);
    setProjectDetail(detail);
    setSelectedIssue(detail.issues[0] ?? null);
    setPage("project");
    setTab(nextTab);
    setQuery("");
    setStatusMode("all");
    setCreateError(null);
  }

  function changeIssueDisplayLimit(value: IssueDisplayLimit) {
    issueDisplayLimitRef.current = value;
    setIssueDisplayLimit(value);
    void refresh(true);
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
    if (!projectDetail?.project.id) {
      setCreateError("Open a project before creating an issue.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    try {
      const created = await api<{ issue: Issue }>("/issues", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: String(data.get("description") ?? ""),
          project_id: projectDetail.project.id,
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
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
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

  const searchScope = `${page}:${page === "project" ? projectDetail?.project.id ?? "" : ""}`;
  const trimmedQuery = query.trim();
  const matchingServerSearch =
    trimmedQuery && serverSearchResult?.query === trimmedQuery && serverSearchResult.scope === searchScope ? serverSearchResult.issues : null;
  const filteredIssues = useMemo(() => {
    const activeIssues = trimmedQuery ? matchingServerSearch ?? [] : projectDetail?.issues ?? workspaceIssues;
    const lower = trimmedQuery.toLowerCase();
    return activeIssues.filter((issue) => {
      const text = `${issue.id} ${issue.external_id ?? ""} ${issue.identifier ?? ""} ${issue.title} ${issue.description ?? ""}`.toLowerCase();
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
  }, [matchingServerSearch, projectDetail?.issues, statusMode, trimmedQuery, workspaceIssues]);
  const sourceIssueGroups = trimmedQuery ? null : projectDetail?.issueGroups ?? workspaceIssueGroups;
  const visibleIssueGroups = useMemo(() => {
    if (trimmedQuery || statusMode === "blockers" || !sourceIssueGroups?.length) return groupIssues(filteredIssues);
    return sourceIssueGroups
      .map(apiGroupToUiGroup)
      .filter((group) => groupMatchesStatusMode(group.statusType, statusMode))
      .filter((group) => group.items.length);
  }, [filteredIssues, sourceIssueGroups, statusMode, trimmedQuery]);

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
            setCreateError(null);
          }}
          onWorkspace={() => {
            setPage("workspace");
            setProjectDetail(null);
            setSelectedIssue(workspaceIssues[0] ?? null);
            setTab("issues");
            setCreateError(null);
          }}
          onTab={setTab}
        />

        {page === "projects" ? (
          <ProjectsPage projects={projects} onOpenProject={openProject} />
        ) : page === "workspace" ? (
          <IssuesPage
            title="All issues"
            issues={filteredIssues}
            issueGroups={visibleIssueGroups}
            selectedIssue={selectedIssue}
            query={query}
            statusMode={statusMode}
            issueDisplayLimit={issueDisplayLimit}
            creating={creating}
            createError={createError}
            canCreate={false}
            onQuery={setQuery}
            onStatusMode={setStatusMode}
            onIssueDisplayLimit={changeIssueDisplayLimit}
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
            issueGroups={visibleIssueGroups}
            selectedIssue={selectedIssue}
            query={query}
            statusMode={statusMode}
            issueDisplayLimit={issueDisplayLimit}
            creating={creating}
            createError={createError}
            canCreate={true}
            onQuery={setQuery}
            onStatusMode={setStatusMode}
            onIssueDisplayLimit={changeIssueDisplayLimit}
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
  issueGroups,
  selectedIssue,
  query,
  statusMode,
  issueDisplayLimit,
  creating,
  createError,
  canCreate,
  onQuery,
  onStatusMode,
  onIssueDisplayLimit,
  onCreate,
  onOpenIssue,
  onAddComment,
}: {
  title: string;
  issues: Issue[];
  issueGroups: UiIssueGroup[];
  selectedIssue: Issue | null;
  query: string;
  statusMode: StatusMode;
  issueDisplayLimit: IssueDisplayLimit;
  creating: boolean;
  createError: string | null;
  canCreate: boolean;
  onQuery: (value: string) => void;
  onStatusMode: (mode: StatusMode) => void;
  onIssueDisplayLimit: (value: IssueDisplayLimit) => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onOpenIssue: (issue: Issue, reveal?: boolean) => void;
  onAddComment: (event: FormEvent<HTMLFormElement>) => void;
}) {
  void issues;
  const grouped = issueGroups;
  return (
    <section className="issues-screen">
      <div className="issue-filter-row">
        <div className="searchbar"><Search size={16} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={`Search ${title}`} /></div>
        <label className="issue-limit-control">
          <span>Per status</span>
          <select aria-label="Issues per status" value={issueDisplayLimit} onChange={(event) => onIssueDisplayLimit(event.target.value as IssueDisplayLimit)}>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="all">All</option>
          </select>
        </label>
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
      {canCreate ? (
        <form className="linear-create" onSubmit={onCreate}>
          <Plus size={16} />
          <input name="title" placeholder={`New issue in ${title}`} />
          <select name="priority" defaultValue="3"><option value="1">P1</option><option value="2">P2</option><option value="3">P3</option><option value="4">P4</option></select>
          <input name="description" placeholder="Short note" />
          <button disabled={creating}>{creating ? "Saving" : "Add"}</button>
        </form>
      ) : (
        <div className="linear-create disabled-create">
          <Plus size={16} />
          <span>Open a project to create an issue</span>
        </div>
      )}
      {createError ? <div className="create-error"><AlertTriangle size={14} />{createError}</div> : null}
      <div className="issues-and-detail">
        <div className="linear-issue-list">
          {grouped.length === 0 ? (
            <div className="empty-list">No issues found</div>
          ) : grouped.map((group) => (
            <div key={group.key} className="issue-group">
              <div className="group-head"><span>⌄</span><StatusIcon statusType={group.statusType} /><strong>{group.label}</strong><em>{groupCountLabel(group)}</em><button><Plus size={14} /></button></div>
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
                    <AgentStateInline issue={issue} />
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
      <AgentStatePanel issue={issue} />
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
        <AgentStatePanel issue={issue} />
        <div className="comments-box">
          <strong>Activity</strong>
          {issue.comments?.map((comment) => <article key={comment.id}><b>{comment.author}</b><span>{comment.body}</span></article>)}
          <form onSubmit={onAddComment}><input name="body" placeholder="Add an agent note" /><button>Add</button></form>
        </div>
      </section>
    </div>
  );
}

function AgentStateInline({ issue }: { issue: Issue }) {
  const claimCount = activeClaimCount(issue);
  const agentLabel = issue.active_claim_agent || issue.active_claims?.[0]?.agent_name;
  const hasAcceptance = Boolean(issue.last_acceptance_at || latestAcceptanceForIssue(issue));
  if (!claimCount && !hasAcceptance) {
    return <span className="agent-inline muted-agent" title="No active agent claim"><UserRound size={15} /></span>;
  }
  return (
    <span className="agent-inline">
      {claimCount > 0 ? (
        <span className={claimCount > 1 ? "agent-chip warning" : "agent-chip"} title={claimCount > 1 ? `${claimCount} active claims` : `Claimed by ${agentLabel || "agent"}`}>
          <UserRound size={13} />
          <span>{agentLabel ? shortAgentName(agentLabel) : claimCount}</span>
        </span>
      ) : null}
      {hasAcceptance ? <CheckCircle2 className="agent-accepted" size={14} aria-label="Accepted" /> : null}
    </span>
  );
}

function AgentStatePanel({ issue }: { issue: Issue }) {
  const claimCount = activeClaimCount(issue);
  const activeClaims = issue.active_claims ?? [];
  const acceptance = issue.last_acceptance_comment ?? latestAcceptanceForIssue(issue);
  const hasClaimConflict = claimCount > 1;
  return (
    <section className={hasClaimConflict ? "agent-state warning" : "agent-state"} aria-label="Agent state">
      <div className="agent-state-head">
        <strong>Agent state</strong>
        {hasClaimConflict ? <span><AlertTriangle size={14} />Multiple active claims</span> : null}
      </div>
      {activeClaims.length ? (
        <div className="agent-state-lines">
          {activeClaims.map((claim) => (
            <div key={claim.id}>
              <UserRound size={14} />
              <span><b>{claim.agent_name}</b>{claim.harness ? ` via ${claim.harness}` : ""}</span>
              {claim.note ? <em>{claim.note}</em> : null}
            </div>
          ))}
        </div>
      ) : claimCount > 0 ? (
        <div className="agent-state-lines">
          <div><UserRound size={14} /><span><b>{issue.active_claim_agent || "Agent"}</b>{issue.active_claim_harness ? ` via ${issue.active_claim_harness}` : ""}</span></div>
        </div>
      ) : (
        <p>No active agent claim.</p>
      )}
      {acceptance ? (
        <div className="acceptance-note">
          <CheckCircle2 size={14} />
          <span><b>{acceptance.author}</b> accepted on {formatShortDate(acceptance.created_at)}: {acceptance.body}</span>
        </div>
      ) : (
        <p>No acceptance comment yet.</p>
      )}
    </section>
  );
}

function issueCode(issue: Pick<Issue, "identifier" | "id">) {
  return issue.identifier || issue.id;
}

function activeClaimCount(issue: Issue) {
  return Number(issue.active_claim_count ?? issue.active_claims?.length ?? 0);
}

function latestAcceptanceForIssue(issue: Issue) {
  return issue.comments?.filter(isAcceptanceComment).at(-1) ?? null;
}

function isAcceptanceComment(comment: IssueComment) {
  const body = comment.body.trim().toLowerCase();
  return (
    body.startsWith("acceptance") ||
    body.startsWith("accepted") ||
    body.startsWith("plan/fact acceptance") ||
    (body.startsWith("repeat ") && body.includes(" acceptance")) ||
    body.startsWith("reviewer-opponent acceptance") ||
    (body.startsWith("closure note:") && body.includes("acceptance was already reached"))
  );
}

function shortAgentName(label: string) {
  const normalized = label.replace(/^Codex GPT-[\d.]+/i, "Codex").replace(/\s+/g, " ").trim();
  if (normalized.length <= 10) return normalized;
  const parts = normalized.split(" ");
  return parts[0].length <= 10 ? parts[0] : `${parts[0].slice(0, 9)}...`;
}

function apiGroupToUiGroup(group: ApiIssueGroup): UiIssueGroup {
  return {
    key: group.key,
    statusType: group.status_type,
    label: group.label,
    total: group.total,
    returned: group.returned,
    truncated: group.truncated,
    items: group.issues,
  };
}

function groupMatchesStatusMode(statusType: IssueStatusType, statusMode: StatusMode) {
  return (
    statusMode === "all" ||
    (statusMode === "active" && ["started", "blocked", "paused"].includes(statusType)) ||
    (statusMode === "paused" && statusType === "paused") ||
    (statusMode === "backlog" && statusType === "backlog") ||
    (statusMode === "todo" && statusType === "unstarted")
  );
}

function groupCountLabel(group: UiIssueGroup) {
  return group.truncated ? `${group.returned}/${group.total}` : String(group.total);
}

function groupIssues(issues: Issue[]): UiIssueGroup[] {
  const order: [IssueStatusType, string][] = [
    ["started", "In Progress"],
    ["blocked", "Blocked"],
    ["paused", "Paused"],
    ["backlog", "Backlog"],
    ["unstarted", "Todo"],
    ["completed", "Done"],
    ["canceled", "Canceled"],
  ];
  return order
    .map(([statusType, label]) => ({
      key: statusType,
      statusType,
      label,
      total: issues.filter((issue) => resolveUiStatusType(issue) === statusType).length,
      returned: issues.filter((issue) => resolveUiStatusType(issue) === statusType).length,
      truncated: false,
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
