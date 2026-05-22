import { customAlphabet } from "nanoid";
import { db, json, nowIso, parseJson } from "./db.js";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const localIssuePrefix = "CTH";
let issueIdentifiersChecked = false;
const normalizedStatusTypeSql = `
  CASE
    WHEN lower(COALESCE(status, '')) IN ('done', 'completed') THEN 'completed'
    WHEN lower(COALESCE(status, '')) IN ('in progress', 'started') THEN 'started'
    WHEN lower(COALESCE(status, '')) IN ('todo', 'to do') THEN 'unstarted'
    WHEN lower(COALESCE(status, '')) IN ('blocked', 'blocker') THEN 'blocked'
    WHEN lower(COALESCE(status, '')) IN ('paused', 'pause') THEN 'paused'
    WHEN lower(COALESCE(status, '')) IN ('canceled', 'cancelled') THEN 'canceled'
    ELSE status_type
  END
`;
const normalizedIssueStatusTypeSql = `
  CASE
    WHEN lower(COALESCE(i.status, '')) IN ('done', 'completed') THEN 'completed'
    WHEN lower(COALESCE(i.status, '')) IN ('in progress', 'started') THEN 'started'
    WHEN lower(COALESCE(i.status, '')) IN ('todo', 'to do') THEN 'unstarted'
    WHEN lower(COALESCE(i.status, '')) IN ('blocked', 'blocker') THEN 'blocked'
    WHEN lower(COALESCE(i.status, '')) IN ('paused', 'pause') THEN 'paused'
    WHEN lower(COALESCE(i.status, '')) IN ('canceled', 'cancelled') THEN 'canceled'
    ELSE i.status_type
  END
`;

export type IssueInput = {
  id?: string;
  external_id?: string;
  identifier?: string;
  issue_id?: string | null;
  title?: string;
  description?: string;
  status?: string;
  status_type?: string;
  priority?: number;
  project_id?: string | null;
  team_id?: string | null;
  parent_id?: string | null;
  assignee?: string | null;
  labels?: string[] | string;
  source?: string;
  url?: string | null;
  archived_at?: string | null;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

type FilterValue = string | string[] | null | undefined;
type AgentSessionInput = { id?: string; agent_name: string; harness?: string | null; ttl_minutes?: number; metadata?: unknown };
type ClaimIssueInput = { issue_id: string; session_id: string; note?: string | null; ttl_minutes?: number; force?: boolean | string | number | null };
type ReleaseIssueClaimInput = {
  issue_id?: string;
  claim_id?: string;
  session_id?: string;
  status?: "released" | "completed";
  force?: boolean | string | number | null;
};
type HydratedIssueClaim = Record<string, unknown> & {
  id: string;
  issue_id: string;
  session_id: string;
  status?: string;
  expires_at?: string;
  released_at?: string | null;
};

export function makeId(prefix: string) {
  return `${prefix}_${nanoid()}`;
}

export function ensureDefaultTeam() {
  const existing = db.prepare("SELECT * FROM teams LIMIT 1").get();
  if (existing) return existing as Record<string, unknown>;
  const at = nowIso();
  db.prepare(`
    INSERT INTO teams (id, name, key, source, created_at, updated_at)
    VALUES (@id, @name, @key, 'local', @created_at, @updated_at)
  `).run({ id: "team_local", name: "Local Agents", key: "LOC", created_at: at, updated_at: at });
  return db.prepare("SELECT * FROM teams WHERE id = 'team_local'").get() as Record<string, unknown>;
}

export function listTeams() {
  return db.prepare("SELECT * FROM teams ORDER BY name").all();
}

export function upsertTeam(input: { id?: string; external_id?: string; name: string; key?: string; source?: string; created_at?: string; updated_at?: string }) {
  const at = nowIso();
  const row = {
    id: input.id ?? input.external_id ?? makeId("team"),
    external_id: input.external_id ?? null,
    name: input.name,
    key: input.key ?? null,
    source: input.source ?? "local",
    created_at: input.created_at ?? at,
    updated_at: input.updated_at ?? at,
  };
  db.prepare(`
    INSERT INTO teams (id, external_id, name, key, source, created_at, updated_at)
    VALUES (@id, @external_id, @name, @key, @source, @created_at, @updated_at)
    ON CONFLICT(external_id) DO UPDATE SET
      name=excluded.name, key=excluded.key, updated_at=excluded.updated_at
  `).run(row);
  return db.prepare("SELECT * FROM teams WHERE external_id IS @external_id OR id = @id").get(row);
}

export function listProjects() {
  ensureIssueIdentifiers();
  return db.prepare(`
    SELECT p.*, COUNT(i.id) AS issue_count
    FROM projects p
    LEFT JOIN issues i ON i.project_id = p.id AND i.archived_at IS NULL
    WHERE p.archived_at IS NULL
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `).all();
}

export function getProject(id: string) {
  ensureIssueIdentifiers();
  const project = db.prepare("SELECT * FROM projects WHERE id = @id OR external_id = @id").get({ id }) as Record<string, unknown> | undefined;
  if (!project) return null;
  const issues = listIssues({ project: String(project.id), limit: 80 });
  const statusCounts = db.prepare(`
    SELECT status, ${normalizedStatusTypeSql} AS status_type, COUNT(*) AS count
    FROM issues
    WHERE project_id = @project_id AND archived_at IS NULL
    GROUP BY status, ${normalizedStatusTypeSql}
    ORDER BY count DESC
  `).all({ project_id: project.id });
  const priorityCounts = db.prepare(`
    SELECT priority, COUNT(*) AS count
    FROM issues
    WHERE project_id = @project_id AND archived_at IS NULL
    GROUP BY priority
    ORDER BY priority
  `).all({ project_id: project.id });
  const counts = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${normalizedStatusTypeSql} = 'completed' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN ${normalizedStatusTypeSql} = 'started' THEN 1 ELSE 0 END) AS started,
      SUM(CASE WHEN ${normalizedStatusTypeSql} IN ('backlog','unstarted','blocked','paused') THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN priority = 1 AND ${normalizedStatusTypeSql} != 'completed' THEN 1 ELSE 0 END) AS blockers
    FROM issues
    WHERE project_id = @project_id AND archived_at IS NULL
  `).get({ project_id: project.id });
  const issueEvents = db.prepare(`
    SELECT
      i.id,
      i.identifier,
      i.title,
      i.status,
      ${normalizedStatusTypeSql} AS status_type,
      i.priority,
      i.updated_at,
      'issue' AS type,
      CASE
        WHEN ${normalizedStatusTypeSql} = 'completed' THEN 'completed'
        WHEN ${normalizedStatusTypeSql} = 'started' THEN 'started'
        WHEN i.priority = 1 THEN 'blocker'
        ELSE 'updated'
      END AS verb
    FROM issues i
    WHERE i.project_id = @project_id AND i.archived_at IS NULL
    ORDER BY i.updated_at DESC
    LIMIT 40
  `).all({ project_id: project.id });
  const commentEvents = db.prepare(`
    SELECT
      c.id,
      i.identifier,
      i.title,
      i.status,
      ${normalizedStatusTypeSql} AS status_type,
      i.priority,
      c.updated_at,
      'comment' AS type,
      'commented' AS verb,
      c.author,
      c.body
    FROM comments c
    JOIN issues i ON i.id = c.issue_id
    WHERE i.project_id = @project_id AND i.archived_at IS NULL
    ORDER BY c.updated_at DESC
    LIMIT 20
  `).all({ project_id: project.id });
  const activity = [...issueEvents, ...commentEvents]
    .sort((a, b) => String((b as { updated_at: string }).updated_at).localeCompare(String((a as { updated_at: string }).updated_at)))
    .slice(0, 50);
  return { project, counts, statusCounts, priorityCounts, issues, activity };
}

export function upsertProject(input: {
  id?: string; external_id?: string; name: string; summary?: string; description?: string; status?: string; priority?: number; lead?: string; source?: string; archived_at?: string | null; created_at?: string; updated_at?: string;
}) {
  const at = nowIso();
  const row = {
    id: input.id ?? input.external_id ?? makeId("project"),
    external_id: input.external_id ?? null,
    name: input.name,
    summary: input.summary ?? null,
    description: input.description ?? null,
    status: input.status ?? "Backlog",
    priority: input.priority ?? 3,
    lead: input.lead ?? null,
    source: input.source ?? "local",
    archived_at: input.archived_at ?? null,
    created_at: input.created_at ?? at,
    updated_at: input.updated_at ?? at,
  };
  db.prepare(`
    INSERT INTO projects (id, external_id, name, summary, description, status, priority, lead, source, archived_at, created_at, updated_at)
    VALUES (@id, @external_id, @name, @summary, @description, @status, @priority, @lead, @source, @archived_at, @created_at, @updated_at)
    ON CONFLICT(external_id) DO UPDATE SET
      name=excluded.name, summary=excluded.summary, description=excluded.description, status=excluded.status,
      priority=excluded.priority, lead=excluded.lead, archived_at=excluded.archived_at, updated_at=excluded.updated_at
  `).run(row);
  return db.prepare("SELECT * FROM projects WHERE external_id IS @external_id OR id = @id").get(row);
}

export function listIssues(filters: { project?: string; project_id?: string; team?: string; team_id?: string; status?: FilterValue; status_type?: FilterValue; include_done?: boolean | string | number | null; query?: string; limit?: number; offset?: number }) {
  ensureIssueIdentifiers();
  const limit = boundedNumber(filters.limit, 50, 1, 250);
  const offset = boundedNumber(filters.offset, 0, 0, 100000);
  const query = typeof filters.query === "string" ? filters.query.trim() : "";
  const projectFilter = filters.project ?? filters.project_id;
  const teamFilter = filters.team ?? filters.team_id;
  const where: string[] = ["i.archived_at IS NULL"];
  const params: Record<string, unknown> = { limit, offset };
  if (projectFilter) {
    where.push("(i.project_id = @project OR p.name = @project OR p.external_id = @project)");
    params.project = projectFilter;
  }
  if (teamFilter) {
    where.push("(i.team_id = @team OR t.name = @team OR t.external_id = @team)");
    params.team = teamFilter;
  }
  const statusValues = filterValues(filters.status);
  if (statusValues.length) {
    const statusTypes = unique(statusValues.map((value) => inferStatusType(value) ?? knownStatusType(value)).filter(isString));
    const rawStatuses = statusValues.filter((value) => !inferStatusType(value) && !knownStatusType(value));
    const clauses: string[] = [];
    if (statusTypes.length) clauses.push(inClause(normalizedIssueStatusTypeSql, "status_type", statusTypes, params));
    if (rawStatuses.length) clauses.push(inClause("i.status", "status", rawStatuses, params));
    where.push(`(${clauses.join(" OR ")})`);
  }
  const statusTypeValues = filterValues(filters.status_type);
  if (statusTypeValues.length) {
    const normalized = unique(statusTypeValues.map((value) => inferStatusType(value) ?? knownStatusType(value) ?? value));
    where.push(inClause(normalizedIssueStatusTypeSql, "status_type_filter", normalized, params));
  }
  if (!booleanValue(filters.include_done, true)) {
    where.push(`${normalizedIssueStatusTypeSql} != 'completed'`);
  }
  let sql = `
    SELECT i.*, p.name AS project_name, t.name AS team_name
    FROM issues i
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN teams t ON t.id = i.team_id
  `;
  if (query) {
    sql += " JOIN issue_fts fts ON fts.rowid = i.rowid";
    where.push("issue_fts MATCH @query");
    params.query = ftsQuery(query);
  }
  sql += ` WHERE ${where.join(" AND ")} ORDER BY i.updated_at DESC LIMIT @limit OFFSET @offset`;
  return db.prepare(sql).all(params).map(hydrateIssue);
}

function ftsQuery(value: string) {
  const tokens = value
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/"/g, '""'))
    .filter(Boolean);
  return tokens.map((token) => `"${token}"`).join(" ");
}

export function getIssue(id: string) {
  ensureIssueIdentifiers();
  const issue = db.prepare(`
    SELECT i.*, p.name AS project_name, t.name AS team_name
    FROM issues i
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN teams t ON t.id = i.team_id
    WHERE i.id = @id OR i.external_id = @id OR i.identifier = @id
  `).get({ id });
  if (!issue) return null;
  const comments = db.prepare("SELECT * FROM comments WHERE issue_id = @issue_id ORDER BY created_at").all({ issue_id: (issue as { id: string }).id });
  return { ...hydrateIssue(issue), comments };
}

export function listTruncatedLinearIssues(limit = 500) {
  return db.prepare(
    "SELECT id, external_id, identifier, title, updated_at " +
      "FROM issues " +
      "WHERE source = 'linear' " +
      "AND description LIKE '%truncated, use `get_issue` for full description%' " +
      "ORDER BY updated_at DESC " +
      "LIMIT @limit",
  ).all({ limit: Math.min(limit, 1000) }) as {
    id: string;
    external_id: string | null;
    identifier: string | null;
    title: string;
    updated_at: string;
  }[];
}

export function upsertIssue(input: IssueInput) {
  const retryAutomaticIdentifier = shouldRetryAutomaticIdentifier(input);
  const maxAttempts = retryAutomaticIdentifier ? 3 : 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const issueKey = upsertIssueTransaction.immediate(input);
      const issue = getIssue(issueKey);
      if (!issue) throw new Error(`Saved issue not found: ${issueKey}`);
      return issue;
    } catch (error) {
      if (attempt < maxAttempts && retryAutomaticIdentifier && isIdentifierUniqueConstraintError(error)) continue;
      throw error;
    }
  }
  throw new Error("save_issue failed after retrying automatic identifier allocation");
}

const upsertIssueTransaction = db.transaction((input: IssueInput) => upsertIssueLocked(input));

function upsertIssueLocked(input: IssueInput) {
  const at = nowIso();
  const existing = resolveIssueForUpsert(input);
  if (!existing && !input.title) {
    throw new Error("title is required when creating an issue");
  }
  const existingStatus = stringValue(existing?.status);
  const status = hasOwn(input, "status") ? input.status ?? "Backlog" : existingStatus ?? "Backlog";
  const statusType =
    inferStatusType(status) ??
    (hasOwn(input, "status") ? statusTypeFromStatusFallback(status) : undefined) ??
    (hasOwn(input, "status_type") ? input.status_type : stringValue(existing?.status_type)) ??
    "backlog";
  const completedAt = hasOwn(input, "completed_at")
    ? input.completed_at ?? null
    : statusType === "completed"
      ? stringValue(existing?.completed_at) ?? at
      : null;
  const row = {
    id: stringValue(existing?.id) ?? input.id ?? input.external_id ?? makeId("issue"),
    external_id: hasOwn(input, "external_id") ? input.external_id ?? null : stringValue(existing?.external_id),
    identifier: resolveIssueIdentifier(input, existing),
    title: input.title ?? stringValue(existing?.title) ?? "Untitled issue",
    description: hasOwn(input, "description") ? input.description ?? null : stringValue(existing?.description),
    status,
    status_type: statusType,
    priority: input.priority ?? numberValue(existing?.priority) ?? 3,
    project_id: hasOwn(input, "project_id") ? resolveProjectId(input.project_id) : stringValue(existing?.project_id),
    team_id: hasOwn(input, "team_id") ? resolveTeamId(input.team_id) : stringValue(existing?.team_id) ?? defaultTeamId(),
    parent_id: hasOwn(input, "parent_id") ? resolveParentId(input.parent_id) : stringValue(existing?.parent_id),
    assignee: hasOwn(input, "assignee") ? input.assignee ?? null : stringValue(existing?.assignee),
    labels: json(hasOwn(input, "labels") ? normalizeLabels(input.labels) : normalizeLabels(existing?.labels)),
    source: input.source ?? stringValue(existing?.source) ?? "local",
    url: hasOwn(input, "url") ? input.url ?? null : stringValue(existing?.url),
    archived_at: hasOwn(input, "archived_at") ? input.archived_at ?? null : stringValue(existing?.archived_at),
    completed_at: completedAt ?? (statusType === "completed" ? at : null),
    created_at: input.created_at ?? stringValue(existing?.created_at) ?? at,
    updated_at: input.updated_at ?? at,
  };
  db.prepare(`
    INSERT INTO issues (id, external_id, identifier, title, description, status, status_type, priority, project_id, team_id, parent_id, assignee, labels, source, url, archived_at, completed_at, created_at, updated_at)
    VALUES (@id, @external_id, @identifier, @title, @description, @status, @status_type, @priority, @project_id, @team_id, @parent_id, @assignee, @labels, @source, @url, @archived_at, @completed_at, @created_at, @updated_at)
    ON CONFLICT(external_id) DO UPDATE SET
      identifier=excluded.identifier, title=excluded.title, description=excluded.description, status=excluded.status,
      status_type=excluded.status_type, priority=excluded.priority, project_id=excluded.project_id, team_id=excluded.team_id,
      parent_id=excluded.parent_id, assignee=excluded.assignee, labels=excluded.labels, url=excluded.url,
      archived_at=excluded.archived_at, completed_at=excluded.completed_at, updated_at=excluded.updated_at
    ON CONFLICT(id) DO UPDATE SET
      external_id=excluded.external_id, identifier=excluded.identifier, title=excluded.title, description=excluded.description, status=excluded.status,
      status_type=excluded.status_type, priority=excluded.priority, project_id=excluded.project_id, team_id=excluded.team_id,
      parent_id=excluded.parent_id, assignee=excluded.assignee, labels=excluded.labels, url=excluded.url,
      archived_at=excluded.archived_at, completed_at=excluded.completed_at, updated_at=excluded.updated_at
  `).run(row);
  return row.id;
}

export function saveComment(input: { id?: string; external_id?: string; issue_id: string; body: string; author?: string; source?: string; created_at?: string; updated_at?: string }) {
  const at = nowIso();
  const issueId = resolveParentId(input.issue_id);
  if (!issueId) throw new Error(`Issue not found: ${input.issue_id}`);
  const externalId = nonEmptyString(input.external_id);
  const row = {
    id: input.id ?? makeId("comment"),
    external_id: externalId,
    issue_id: issueId,
    body: input.body,
    author: input.author ?? "Agent",
    source: input.source ?? "local",
    created_at: input.created_at ?? at,
    updated_at: input.updated_at ?? at,
  };
  db.prepare(`
    INSERT INTO comments (id, external_id, issue_id, body, author, source, created_at, updated_at)
    VALUES (@id, @external_id, @issue_id, @body, @author, @source, @created_at, @updated_at)
    ON CONFLICT(external_id) DO UPDATE SET body=excluded.body, author=excluded.author, updated_at=excluded.updated_at
  `).run(row);
  if (row.external_id) {
    return db.prepare("SELECT * FROM comments WHERE external_id = @external_id").get(row);
  }
  return db.prepare("SELECT * FROM comments WHERE id = @id").get(row);
}

export function startAgentSession(input: AgentSessionInput) {
  if (!nonEmptyString(input.agent_name)) throw new Error("agent_name is required");
  const at = nowIso();
  const row = {
    id: input.id ?? makeId("session"),
    agent_name: input.agent_name,
    harness: nonEmptyString(input.harness),
    status: "active",
    started_at: at,
    last_heartbeat_at: at,
    expires_at: addMinutes(at, ttlMinutes(input.ttl_minutes)),
    ended_at: null,
    metadata: json(input.metadata ?? {}),
  };
  db.prepare(`
    INSERT INTO agent_sessions (id, agent_name, harness, status, started_at, last_heartbeat_at, expires_at, ended_at, metadata)
    VALUES (@id, @agent_name, @harness, @status, @started_at, @last_heartbeat_at, @expires_at, @ended_at, @metadata)
    ON CONFLICT(id) DO UPDATE SET
      agent_name=excluded.agent_name,
      harness=excluded.harness,
      status='active',
      last_heartbeat_at=excluded.last_heartbeat_at,
      expires_at=excluded.expires_at,
      ended_at=NULL,
      metadata=excluded.metadata
  `).run(row);
  return getAgentSession(row.id);
}

export function heartbeatAgentSession(input: { session_id: string; ttl_minutes?: number }) {
  const session = getAgentSession(input.session_id);
  if (!session) throw new Error(`Agent session not found: ${input.session_id}`);
  const at = nowIso();
  db.prepare(`
    UPDATE agent_sessions
    SET status='active', last_heartbeat_at=@last_heartbeat_at, expires_at=@expires_at, ended_at=NULL
    WHERE id=@id
  `).run({ id: input.session_id, last_heartbeat_at: at, expires_at: addMinutes(at, ttlMinutes(input.ttl_minutes)) });
  return getAgentSession(input.session_id);
}

export function endAgentSession(input: { session_id: string; release_claims?: boolean | string | number | null }) {
  const session = getAgentSession(input.session_id);
  if (!session) throw new Error(`Agent session not found: ${input.session_id}`);
  const at = nowIso();
  const releaseClaims = booleanValue(input.release_claims, true);
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE agent_sessions
      SET status='ended', ended_at=@ended_at, last_heartbeat_at=@ended_at, expires_at=@ended_at
      WHERE id=@id
    `).run({ id: input.session_id, ended_at: at });
    if (releaseClaims) {
      db.prepare(`
        UPDATE issue_claims
        SET status='released', released_at=@released_at
        WHERE session_id=@session_id AND released_at IS NULL
      `).run({ session_id: input.session_id, released_at: at });
    }
  });
  tx();
  return { session: getAgentSession(input.session_id), released_claims: releaseClaims ? listIssueClaims({ session_id: input.session_id, include_released: true }) : [] };
}

export function listAgentSessions(input: { include_ended?: boolean | string | number | null; limit?: number } = {}) {
  const now = nowIso();
  const where = booleanValue(input.include_ended, false) ? "" : "WHERE status = 'active' AND expires_at > @now";
  return db.prepare(`
    SELECT *
    FROM agent_sessions
    ${where}
    ORDER BY last_heartbeat_at DESC
    LIMIT @limit
  `).all({ limit: boundedNumber(input.limit, 50, 1, 250), now }).map(hydrateAgentSession);
}

export function claimIssue(input: ClaimIssueInput) {
  const at = nowIso();
  const issueId = resolveParentId(input.issue_id);
  if (!issueId) throw new Error(`Issue not found: ${input.issue_id}`);
  const session = getActiveAgentSession(input.session_id, at);
  if (!session) throw new Error(`Active agent session not found: ${input.session_id}`);
  heartbeatAgentSession({ session_id: input.session_id, ttl_minutes: input.ttl_minutes });
  const expiredReleased = expireIssueClaims(issueId, at);
  const activeClaims = activeIssueClaims(issueId, at);
  const active = activeClaims[0];
  const expiresAt = addMinutes(at, ttlMinutes(input.ttl_minutes));
  const sameSessionActive = activeClaims.find((claim) => claim.session_id === input.session_id);
  if (sameSessionActive) {
    supersedeOtherActiveIssueClaims(issueId, sameSessionActive.id, at);
    db.prepare(`
      UPDATE issue_claims
      SET status='active', note=@note, heartbeat_at=@heartbeat_at, expires_at=@expires_at
      WHERE id=@id
    `).run({ id: sameSessionActive.id, note: input.note ?? sameSessionActive.note ?? null, heartbeat_at: at, expires_at: expiresAt });
    return { claim: getIssueClaim(sameSessionActive.id), idempotent: true, forced: false, expired_released: expiredReleased };
  }
  let forced = false;
  if (active) {
    if (!booleanValue(input.force, false)) {
      throw new Error(`Issue already claimed by ${active.agent_name} (${active.session_id}) until ${active.expires_at}`);
    }
    forced = true;
    supersedeActiveIssueClaims(issueId, at);
  }
  const row = {
    id: makeId("claim"),
    issue_id: issueId,
    session_id: input.session_id,
    agent_name: session.agent_name,
    status: "active",
    note: input.note ?? null,
    claimed_at: at,
    heartbeat_at: at,
    expires_at: expiresAt,
    released_at: null,
    force: forced ? 1 : 0,
  };
  db.prepare(`
    INSERT INTO issue_claims (id, issue_id, session_id, agent_name, status, note, claimed_at, heartbeat_at, expires_at, released_at, force)
    VALUES (@id, @issue_id, @session_id, @agent_name, @status, @note, @claimed_at, @heartbeat_at, @expires_at, @released_at, @force)
  `).run(row);
  return { claim: getIssueClaim(row.id), idempotent: false, forced, expired_released: expiredReleased };
}

export function releaseIssueClaim(input: ReleaseIssueClaimInput) {
  const at = nowIso();
  const claimById = input.claim_id ? getIssueClaim(input.claim_id) as HydratedIssueClaim | null : null;
  if (input.claim_id && !claimById) throw new Error(`Issue claim not found: ${input.claim_id}`);
  const issueId = claimById?.issue_id ?? resolveParentId(input.issue_id);
  if (!issueId) {
    if (input.claim_id) throw new Error(`Issue claim has no issue_id: ${input.claim_id}`);
    if (!input.issue_id) throw new Error("release_issue_claim requires either claim_id or issue_id");
    throw new Error(`Issue not found: ${input.issue_id}`);
  }
  expireIssueClaims(issueId, at);
  if (claimById) {
    const refreshedClaim = getIssueClaim(claimById.id) as HydratedIssueClaim | null;
    if (!refreshedClaim) throw new Error(`Issue claim not found: ${claimById.id}`);
    const forced = booleanValue(input.force, false);
    if (input.session_id && refreshedClaim.session_id !== input.session_id && !forced) {
      throw new Error(`Issue claim belongs to ${refreshedClaim.session_id}; release with that session_id or force=true`);
    }
    if (refreshedClaim.released_at || refreshedClaim.status !== "active" || !refreshedClaim.expires_at || refreshedClaim.expires_at <= at) {
      return { released: false, claim: refreshedClaim };
    }
    const status = input.status === "completed" ? "completed" : "released";
    db.prepare("UPDATE issue_claims SET status=@status, released_at=@released_at WHERE id=@id").run({ id: refreshedClaim.id, status, released_at: at });
    const supersededActiveDuplicates = supersedeOtherActiveIssueClaims(issueId, refreshedClaim.id, at);
    return { released: true, claim: getIssueClaim(refreshedClaim.id), superseded_active_duplicates: supersededActiveDuplicates };
  }
  if (!input.session_id) throw new Error("release_issue_claim requires session_id when claim_id is not provided");
  const activeClaims = activeIssueClaims(issueId, at);
  if (!activeClaims.length) return { released: false, claim: null };
  const forced = booleanValue(input.force, false);
  const claim = activeClaims.find((item) => item.session_id === input.session_id) ?? (forced ? activeClaims[0] : undefined);
  if (!claim) {
    const active = activeClaims[0];
    throw new Error(`Issue claim belongs to ${active.session_id}; release with that session_id or force=true`);
  }
  const status = input.status === "completed" ? "completed" : "released";
  db.prepare("UPDATE issue_claims SET status=@status, released_at=@released_at WHERE id=@id").run({ id: claim.id, status, released_at: at });
  const supersededActiveDuplicates = supersedeOtherActiveIssueClaims(issueId, claim.id, at);
  return { released: true, claim: getIssueClaim(claim.id), superseded_active_duplicates: supersededActiveDuplicates };
}

export function listIssueClaims(input: { issue_id?: string; session_id?: string; include_released?: boolean | string | number | null; limit?: number } = {}) {
  const where: string[] = [];
  const params: Record<string, unknown> = { limit: boundedNumber(input.limit, 50, 1, 250), now: nowIso() };
  if (input.issue_id) {
    const issueId = resolveParentId(input.issue_id);
    if (!issueId) throw new Error(`Issue not found: ${input.issue_id}`);
    where.push("c.issue_id = @issue_id");
    params.issue_id = issueId;
  }
  if (input.session_id) {
    where.push("c.session_id = @session_id");
    params.session_id = input.session_id;
  }
  if (!booleanValue(input.include_released, false)) where.push("c.released_at IS NULL AND c.status='active' AND c.expires_at > @now");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db.prepare(`
    SELECT c.*, i.identifier, i.title, s.harness
    FROM issue_claims c
    JOIN issues i ON i.id = c.issue_id
    JOIN agent_sessions s ON s.id = c.session_id
    ${whereSql}
    ORDER BY c.claimed_at DESC
    LIMIT @limit
  `).all(params).map(hydrateIssueClaim);
}

export function dashboard() {
  ensureIssueIdentifiers();
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM projects WHERE archived_at IS NULL) AS projects,
      (SELECT COUNT(*) FROM issues WHERE archived_at IS NULL) AS issues,
      (SELECT COUNT(*) FROM issues WHERE ${normalizedStatusTypeSql} = 'completed' AND archived_at IS NULL) AS done,
      (SELECT COUNT(*) FROM issues WHERE ${normalizedStatusTypeSql} IN ('started','unstarted','blocked','paused') AND archived_at IS NULL) AS active
  `).get();
  const byStatus = db.prepare("SELECT status, COUNT(*) AS count FROM issues WHERE archived_at IS NULL GROUP BY status ORDER BY count DESC").all();
  const recent = listIssues({ limit: 12 });
  return { counts, byStatus, recent };
}

export function startSyncRun(source: string) {
  const id = makeId("sync");
  db.prepare("INSERT INTO sync_runs (id, source, status, started_at) VALUES (@id, @source, 'running', @started_at)").run({
    id,
    source,
    started_at: nowIso(),
  });
  return id;
}

export function finishSyncRun(id: string, status: "completed" | "failed", stats: unknown, cursor?: string, error?: string) {
  const run = db.prepare("SELECT source FROM sync_runs WHERE id = @id").get({ id }) as { source?: string } | undefined;
  db.prepare(`
    UPDATE sync_runs
    SET status=@status, finished_at=@finished_at, stats=@stats, cursor=@cursor, error=@error
    WHERE id=@id
  `).run({
    id,
    status,
    finished_at: nowIso(),
    stats: json(stats),
    cursor: cursor ?? null,
    error: error ?? null,
  });
  if (status === "completed" && run?.source === "linear" && cursor) {
    db.prepare(`
      INSERT INTO sync_checkpoints (source, cursor, updated_at)
      VALUES (@source, @cursor, @updated_at)
      ON CONFLICT(source) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at
    `).run({ source: run.source, cursor, updated_at: nowIso() });
  }
}

export function recentSyncRuns(limit = 10) {
  return db.prepare("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT @limit").all({ limit });
}

export function repairIssueInvariants() {
  const rows = db.prepare(`
    SELECT id, status, status_type, completed_at, updated_at, labels
    FROM issues
  `).all() as {
    id: string;
    status: string;
    status_type: string;
    completed_at: string | null;
    updated_at: string;
    labels: string;
  }[];
  const stats = {
    issuesChecked: rows.length,
    statusTypeFixed: 0,
    completedAtFixed: 0,
    labelsFixed: 0,
    issuesChanged: 0,
  };
  const update = db.prepare(`
    UPDATE issues
    SET status_type = @status_type,
        completed_at = @completed_at,
        labels = @labels
    WHERE id = @id
  `);
  const tx = db.transaction(() => {
    for (const row of rows) {
      const statusType = inferStatusType(row.status) ?? knownStatusType(row.status_type) ?? row.status_type;
      const completedAt = statusType === "completed" && !row.completed_at ? row.updated_at || nowIso() : row.completed_at;
      const labels = json(normalizeLabels(row.labels));
      const statusTypeChanged = statusType !== row.status_type;
      const completedAtChanged = completedAt !== row.completed_at;
      const labelsChanged = labels !== row.labels;
      if (!statusTypeChanged && !completedAtChanged && !labelsChanged) continue;
      if (statusTypeChanged) stats.statusTypeFixed += 1;
      if (completedAtChanged) stats.completedAtFixed += 1;
      if (labelsChanged) stats.labelsFixed += 1;
      stats.issuesChanged += 1;
      update.run({ id: row.id, status_type: statusType, completed_at: completedAt, labels });
    }
  });
  tx();
  return stats;
}

export function getSyncCheckpoint(source: string) {
  return db.prepare("SELECT * FROM sync_checkpoints WHERE source = @source").get({ source }) as { source: string; cursor: string | null; updated_at: string } | undefined;
}

function hydrateIssue(row: unknown) {
  const item = row as Record<string, unknown>;
  const status = typeof item.status === "string" ? item.status : undefined;
  const statusType = typeof item.status_type === "string" ? item.status_type : undefined;
  return { ...item, status_type: inferStatusType(status) ?? statusType, labels: normalizeLabels(item.labels) };
}

function hydrateAgentSession(row: unknown) {
  const item = row as Record<string, unknown>;
  return { ...item, metadata: parseJson(item.metadata as string | null | undefined, {}) };
}

function hydrateIssueClaim(row: unknown) {
  const item = row as Record<string, unknown>;
  return { ...item, force: Boolean(item.force) };
}

function getAgentSession(id: string) {
  const row = db.prepare("SELECT * FROM agent_sessions WHERE id = @id").get({ id });
  return row ? hydrateAgentSession(row) : null;
}

function getActiveAgentSession(id: string, at = nowIso()) {
  const session = getAgentSession(id) as { status?: string; expires_at?: string } | null;
  if (!session || session.status !== "active" || !session.expires_at || session.expires_at <= at) return null;
  return session as Record<string, unknown> & { agent_name: string };
}

function getIssueClaim(id: string) {
  const row = db.prepare(`
    SELECT c.*, i.identifier, i.title, s.harness
    FROM issue_claims c
    JOIN issues i ON i.id = c.issue_id
    JOIN agent_sessions s ON s.id = c.session_id
    WHERE c.id = @id
  `).get({ id });
  return row ? hydrateIssueClaim(row) : null;
}

function activeIssueClaims(issueId: string, at = nowIso()) {
  return db.prepare(`
    SELECT *
    FROM issue_claims
    WHERE issue_id=@issue_id AND released_at IS NULL AND status='active' AND expires_at > @at
    ORDER BY claimed_at DESC
  `).all({ issue_id: issueId, at }) as { id: string; session_id: string; agent_name: string; note: string | null; expires_at: string }[];
}

function supersedeActiveIssueClaims(issueId: string, at = nowIso()) {
  return db.prepare(`
    UPDATE issue_claims
    SET status='superseded', released_at=@released_at
    WHERE issue_id=@issue_id AND released_at IS NULL AND status='active' AND expires_at > @released_at
  `).run({ issue_id: issueId, released_at: at }).changes;
}

function supersedeOtherActiveIssueClaims(issueId: string, keepClaimId: string, at = nowIso()) {
  return db.prepare(`
    UPDATE issue_claims
    SET status='superseded', released_at=@released_at
    WHERE issue_id=@issue_id AND id != @keep_claim_id AND released_at IS NULL AND status='active' AND expires_at > @released_at
  `).run({ issue_id: issueId, keep_claim_id: keepClaimId, released_at: at }).changes;
}

function expireIssueClaims(issueId: string, at = nowIso()) {
  const result = db.prepare(`
    UPDATE issue_claims
    SET status='expired', released_at=@released_at
    WHERE issue_id=@issue_id AND released_at IS NULL AND expires_at <= @released_at
  `).run({ issue_id: issueId, released_at: at });
  return result.changes;
}

function ttlMinutes(value: unknown) {
  return boundedNumber(value, 60, 1, 24 * 60);
}

function addMinutes(iso: string, minutes: number) {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function inferStatusType(status?: string) {
  const normalized = status?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["done", "completed"].includes(normalized)) return "completed";
  if (["in progress", "started"].includes(normalized)) return "started";
  if (["todo", "to do"].includes(normalized)) return "unstarted";
  if (["blocked", "blocker"].includes(normalized)) return "blocked";
  if (["paused", "pause"].includes(normalized)) return "paused";
  if (["canceled", "cancelled"].includes(normalized)) return "canceled";
  return undefined;
}

function knownStatusType(status?: string) {
  const normalized = status?.trim().toLowerCase();
  if (["backlog", "unstarted", "started", "completed", "blocked", "paused", "canceled", "cancelled"].includes(normalized ?? "")) {
    return normalized === "cancelled" ? "canceled" : normalized;
  }
  return undefined;
}

export function ensureIssueIdentifiers() {
  if (issueIdentifiersChecked) return;
  const tx = db.transaction(() => {
    const rows = db.prepare(`
      SELECT id, identifier
      FROM issues
      ORDER BY created_at, rowid
    `).all() as { id: string; identifier: string | null }[];
    const used = new Set(rows.map((row) => row.identifier).filter(isShortIssueIdentifier));
    let next = nextLocalIssueNumber(used);
    const update = db.prepare("UPDATE issues SET identifier = @identifier WHERE id = @id");
    for (const row of rows) {
      if (isShortIssueIdentifier(row.identifier)) continue;
      const identifier = formatLocalIssueIdentifier(next++);
      used.add(identifier);
      update.run({ id: row.id, identifier });
    }
  });
  tx.immediate();
  issueIdentifiersChecked = true;
}

function resolveIssueIdentifier(input: IssueInput, existing?: Record<string, unknown>) {
  const requested = hasOwn(input, "identifier") ? input.identifier ?? null : undefined;
  if (isShortIssueIdentifier(requested)) return requested;
  const current = stringValue(existing?.identifier);
  if (isShortIssueIdentifier(current)) return current;
  return nextLocalIssueIdentifier();
}

function nextLocalIssueIdentifier() {
  const rows = db.prepare("SELECT identifier FROM issues WHERE identifier LIKE @prefix").all({ prefix: `${localIssuePrefix}-%` }) as { identifier: string | null }[];
  return formatLocalIssueIdentifier(nextLocalIssueNumber(new Set(rows.map((row) => row.identifier).filter(isShortIssueIdentifier))));
}

function nextLocalIssueNumber(used: Set<string>) {
  let max = 0;
  for (const identifier of used) {
    const match = new RegExp(`^${localIssuePrefix}-(\\d+)$`).exec(identifier);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

function formatLocalIssueIdentifier(value: number) {
  return `${localIssuePrefix}-${String(value).padStart(3, "0")}`;
}

function isShortIssueIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z][A-Z0-9]{1,8}-\d{1,6}$/.test(value);
}

function statusTypeFromStatusFallback(status?: string) {
  return status?.trim() ? "backlog" : undefined;
}

function shouldRetryAutomaticIdentifier(input: IssueInput) {
  return !isShortIssueIdentifier(input.identifier);
}

function isIdentifierUniqueConstraintError(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "SQLITE_CONSTRAINT_UNIQUE" && message.includes("issues.identifier");
}

function hasOwn<T extends object>(input: T, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : value == null ? null : String(value);
}

function lowerString(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : undefined;
}

function booleanValue(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = lowerString(value);
  if (!normalized) return fallback;
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  return fallback;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : undefined;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : fallback;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.trunc(numeric), min), max);
}

function filterValues(value: FilterValue) {
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function inClause(expression: string, prefix: string, values: string[], params: Record<string, unknown>) {
  const names = values.map((value, index) => {
    const key = `${prefix}_${Object.keys(params).length}_${index}`;
    params[key] = value;
    return `@${key}`;
  });
  return `${expression} IN (${names.join(", ")})`;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function resolveIssueForUpsert(input: IssueInput) {
  if (hasOwn(input, "issue_id")) {
    const issueId = nonEmptyString(input.issue_id);
    if (!issueId) throw new Error(`Issue not found: ${stringValue(input.issue_id) ?? ""}`);
    const existing = getIssueRowByLocator(issueId);
    if (!existing) throw new Error(`Issue not found: ${issueId}`);
    assertCompatibleIssueLocators(input, existing);
    return existing;
  }
  const lookupId = input.external_id ?? input.id ?? input.identifier;
  return lookupId ? getIssueRowByLocator(lookupId) : undefined;
}

function assertCompatibleIssueLocators(input: IssueInput, existing: Record<string, unknown>) {
  for (const field of ["id", "external_id", "identifier"] as const) {
    if (!hasOwn(input, field)) continue;
    const value = nonEmptyString(input[field]);
    if (!value) continue;
    const resolved = getIssueRowByLocator(value);
    if (resolved && stringValue(resolved.id) !== stringValue(existing.id)) {
      throw new Error(`Conflicting issue locator ${field}: ${value} resolves to ${issueLabel(resolved)}, but issue_id resolves to ${issueLabel(existing)}`);
    }
  }
}

function getIssueRowByLocator(value: string) {
  return db.prepare("SELECT * FROM issues WHERE id = @id OR external_id = @id OR identifier = @id").get({ id: value }) as Record<string, unknown> | undefined;
}

function issueLabel(issue: Record<string, unknown>) {
  return stringValue(issue.identifier) ?? stringValue(issue.id) ?? "unknown issue";
}

function normalizeLabels(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value) return [];
  const parsed = parseJson<unknown>(value, []);
  if (typeof parsed === "string" && parsed !== value) return normalizeLabels(parsed);
  if (Array.isArray(parsed)) return normalizeLabels(parsed);
  return [];
}

function resolveProjectId(value: string | null | undefined) {
  const project = value ? db.prepare("SELECT id FROM projects WHERE id = @id OR external_id = @id").get({ id: value }) as { id: string } | undefined : undefined;
  return project?.id ?? null;
}

function resolveTeamId(value: string | null | undefined) {
  const team = value ? db.prepare("SELECT id FROM teams WHERE id = @id OR external_id = @id").get({ id: value }) as { id: string } | undefined : undefined;
  return team?.id ?? null;
}

function defaultTeamId() {
  return String((ensureDefaultTeam() as { id: string }).id);
}

function resolveParentId(value: string | null | undefined) {
  const issue = value ? db.prepare("SELECT id FROM issues WHERE id = @id OR external_id = @id OR identifier = @id").get({ id: value }) as { id: string } | undefined : undefined;
  return issue?.id ?? null;
}
