import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const tempDir = mkdtempSync(join(tmpdir(), "claw-task-hub-store-"));
process.env.CLAW_TASK_HUB_DB = join(tempDir, "test.sqlite");

try {
  const {
    claimIssue,
    endAgentSession,
    ensureDefaultTeam,
    getIssue,
    heartbeatAgentSession,
    listAgentSessions,
    listIssueClaims,
    listIssues,
    releaseIssueClaim,
    repairIssueInvariants,
    saveComment,
    startAgentSession,
    upsertIssue,
    upsertProject,
    upsertTeam,
  } = await import("../server/store.ts");
  const { db, dbPath, resolveDbPath } = await import("../server/db.ts");
  assert(dbPath === process.env.CLAW_TASK_HUB_DB, `CLAW_TASK_HUB_DB did not select the test DB: ${dbPath}`);
  assert(
    resolveDbPath({ CODEX_TASK_HUB_DB: join(tempDir, "legacy-env.sqlite") }, false) === join(tempDir, "legacy-env.sqlite"),
    "CODEX_TASK_HUB_DB legacy override is not honored",
  );
  assert(
    resolveDbPath({}, true).endsWith("codex-task-hub.sqlite"),
    "Existing legacy codex-task-hub.sqlite should remain the default DB",
  );
  assert(
    resolveDbPath({}, false).endsWith("claw-task-hub.sqlite"),
    "Fresh installs should default to claw-task-hub.sqlite",
  );
  ensureDefaultTeam();

  const created = upsertIssue({
    title: "Identifier/id collision regression",
    identifier: "CTH-900001",
    status: "Todo",
    status_type: "unstarted",
  });

  const updated = upsertIssue({
    id: "CTH-900001",
    status: "Paused",
    description: "Updated through the visible identifier passed as id.",
  });

  assert(updated.id === created.id, `save_issue created or returned the wrong row: ${updated.id} !== ${created.id}`);
  assert(updated.identifier === "CTH-900001", `identifier changed unexpectedly: ${updated.identifier}`);
  assert(updated.status === "Paused", `status was not updated: ${updated.status}`);
  assert(updated.status_type === "paused", `status_type was not inferred from Paused: ${updated.status_type}`);

  const fetched = getIssue("CTH-900001");
  assert(fetched?.id === created.id, "getIssue(identifier) does not return the updated issue");
  assert(fetched.description === "Updated through the visible identifier passed as id.", "description was not updated");

  const issueIdAliasTarget = upsertIssue({
    title: "issue_id alias target",
    identifier: "CTH-900011",
    external_id: "issue-id-alias-external",
    status: "Todo",
    project_id: null,
  });
  const issueIdInternalUpdate = upsertIssue({
    issue_id: issueIdAliasTarget.id,
    status: "In Progress",
    description: "Updated through internal issue_id alias.",
  });
  assert(issueIdInternalUpdate.id === issueIdAliasTarget.id, "issue_id internal id alias updated the wrong row");
  assert(issueIdInternalUpdate.identifier === "CTH-900011", "issue_id internal id alias did not preserve identifier");
  const issueIdVisibleUpdate = upsertIssue({
    issue_id: "CTH-900011",
    priority: 1,
  });
  assert(issueIdVisibleUpdate.id === issueIdAliasTarget.id, "issue_id visible identifier alias updated the wrong row");
  assert(issueIdVisibleUpdate.priority === 1, "issue_id visible identifier alias did not update priority");
  const issueIdExternalUpdate = upsertIssue({
    issue_id: "issue-id-alias-external",
    description: "Updated through external issue_id alias.",
  });
  assert(issueIdExternalUpdate.id === issueIdAliasTarget.id, "issue_id external id alias updated the wrong row");
  assert(issueIdExternalUpdate.description === "Updated through external issue_id alias.", "issue_id external id alias did not update description");
  const issueIdExternalBackfill = upsertIssue({
    issue_id: "CTH-900011",
    external_id: "issue-id-alias-backfilled-external",
    description: "Backfilled external id through issue_id alias.",
  });
  assert(issueIdExternalBackfill.id === issueIdAliasTarget.id, "issue_id plus new external_id updated the wrong row");
  assert(issueIdExternalBackfill.external_id === "issue-id-alias-backfilled-external", "issue_id plus new external_id did not persist the external id");
  assert(getIssue("issue-id-alias-backfilled-external")?.id === issueIdAliasTarget.id, "backfilled external id does not resolve to the target issue");
  const rowCountBeforeBadIssueId = db.prepare("SELECT COUNT(*) AS count FROM issues").get().count;
  let badIssueIdMessage = "";
  try {
    upsertIssue({
      issue_id: "CTH-DOES-NOT-EXIST",
      title: "Wrong locator must not create a duplicate",
      status: "Todo",
    });
  } catch (error) {
    badIssueIdMessage = error instanceof Error ? error.message : String(error);
  }
  const rowCountAfterBadIssueId = db.prepare("SELECT COUNT(*) AS count FROM issues").get().count;
  assert(badIssueIdMessage === "Issue not found: CTH-DOES-NOT-EXIST", `issue_id not-found error was not clear: ${badIssueIdMessage}`);
  assert(rowCountAfterBadIssueId === rowCountBeforeBadIssueId, "issue_id not-found created a duplicate row");
  const conflictingLocator = upsertIssue({
    title: "Conflicting locator target",
    identifier: "CTH-900012",
    status: "Todo",
  });
  let conflictingLocatorMessage = "";
  try {
    upsertIssue({
      issue_id: "CTH-900011",
      identifier: conflictingLocator.identifier,
      title: "Conflicting issue_id locator must fail",
    });
  } catch (error) {
    conflictingLocatorMessage = error instanceof Error ? error.message : String(error);
  }
  assert(conflictingLocatorMessage.includes("Conflicting issue locator identifier"), `conflicting locator did not fail clearly: ${conflictingLocatorMessage}`);

  upsertIssue({
    title: "Explicit identifier owner",
    identifier: "CTH-999998",
    status: "Todo",
  });
  let explicitConflictCode = "";
  let explicitConflictMessage = "";
  try {
    upsertIssue({
      id: "explicit-identifier-conflict-row",
      identifier: "CTH-999998",
      title: "Explicit identifier duplicate must fail",
      status: "Todo",
    });
  } catch (error) {
    explicitConflictCode = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    explicitConflictMessage = error instanceof Error ? error.message : String(error);
  }
  assert(explicitConflictCode === "SQLITE_CONSTRAINT_UNIQUE", `explicit duplicate identifier did not fail with a unique constraint: ${explicitConflictCode}`);
  assert(explicitConflictMessage.includes("issues.identifier"), `explicit duplicate identifier failed on the wrong constraint: ${explicitConflictMessage}`);
  assert(!getIssue("explicit-identifier-conflict-row"), "explicit duplicate identifier created a second row");

  const team = upsertTeam({
    id: "team_linear",
    external_id: "linear-team",
    name: "Linear Imported Team",
    key: "LIN",
  });
  const project = upsertProject({
    id: "project_linear",
    external_id: "linear-project",
    name: "Linear Imported Project",
  });
  const migrated = upsertIssue({
    external_id: "linear-issue-1",
    identifier: "SAV-900001",
    title: "Migrated metadata survives partial updates",
    description: "Original migrated description",
    status: "Todo",
    priority: 3,
    project_id: project.id,
    team_id: team.id,
    source: "linear",
    url: "https://linear.app/example/issue/SAV-900001",
    labels: ["linear", "metadata"],
  });
  const partial = upsertIssue({
    id: "SAV-900001",
    status: "In Progress",
    description: "Only status and description changed.",
  });
  assert(partial.id === migrated.id, "partial update by visible identifier returned a different issue");
  assert(partial.project_id === project.id, "partial save_issue update lost project_id");
  assert(partial.team_id === team.id, "partial save_issue update lost team_id");
  assert(partial.source === "linear", "partial save_issue update lost source");
  assert(partial.url === "https://linear.app/example/issue/SAV-900001", "partial save_issue update lost url");

  const done = upsertIssue({
    title: "Done issue status and labels normalize",
    identifier: "CTH-900002",
    status: "Done",
    status_type: "backlog",
    labels: JSON.stringify(["theme", "security"]),
  });
  assert(done.status_type === "completed", `Done issue stored wrong status_type: ${done.status_type}`);
  assert(Array.isArray(done.labels) && done.labels.join(",") === "theme,security", "labels were not normalized to an array");

  const started = upsertIssue({ title: "Array filter started", identifier: "CTH-900003", status: "In Progress" });
  const blocked = upsertIssue({ title: "Array filter blocked", identifier: "CTH-900004", status: "Blocked" });
  const arrayFiltered = listIssues({ status_type: ["started", "blocked"], limit: 20 });
  const arrayFilteredIds = new Set(arrayFiltered.map((issue) => issue.identifier));
  assert(arrayFilteredIds.has(started.identifier), "listIssues array status_type missed started issue");
  assert(arrayFilteredIds.has(blocked.identifier), "listIssues array status_type missed blocked issue");
  assert(!arrayFilteredIds.has(done.identifier), "listIssues array status_type included completed issue unexpectedly");

  const filterProject = upsertProject({
    id: "project_filter_regression",
    external_id: "project-filter-regression",
    name: "Filter Regression Project",
  });
  const projectDone = upsertIssue({ title: "Project completed filter target", identifier: "CTH-900008", status: "Done", project_id: filterProject.id });
  const projectStarted = upsertIssue({ title: "Project active filter target", identifier: "CTH-900009", status: "In Progress", project_id: filterProject.id });
  const projectBacklog = upsertIssue({ title: "Project backlog filter target", identifier: "CTH-900010", status: "Backlog", project_id: filterProject.id });
  const projectActiveOnly = listIssues({ project_id: filterProject.id, include_done: false, limit: 20 });
  const projectActiveIds = new Set(projectActiveOnly.map((issue) => issue.identifier));
  assert(projectActiveIds.has(projectStarted.identifier), "include_done:false missed a project active issue");
  assert(projectActiveIds.has(projectBacklog.identifier), "include_done:false missed a project backlog issue");
  assert(!projectActiveIds.has(projectDone.identifier), "include_done:false included a project completed issue");
  assert(projectActiveOnly.every((issue) => issue.status_type !== "completed"), "include_done:false returned completed status_type in project scope");
  const globalActiveOnly = listIssues({ include_done: false, limit: 250 });
  assert(globalActiveOnly.every((issue) => issue.status_type !== "completed"), "include_done:false returned completed status_type globally");
  const mixedActiveOnly = listIssues({ project_id: filterProject.id, status_type: ["backlog", "started"], include_done: false, limit: 20 });
  const mixedActiveIds = new Set(mixedActiveOnly.map((issue) => issue.identifier));
  assert(mixedActiveIds.has(projectStarted.identifier), "status_type array with include_done:false missed started issue");
  assert(mixedActiveIds.has(projectBacklog.identifier), "status_type array with include_done:false missed backlog issue");
  assert(!mixedActiveIds.has(projectDone.identifier), "status_type array with include_done:false included completed issue");
  const noCompleted = listIssues({ project_id: filterProject.id, status_type: ["completed"], include_done: false, limit: 20 });
  assert(noCompleted.length === 0, "include_done:false did not win over explicit completed status_type");

  const oldComment = saveComment({ issue_id: created.id, body: "Older null external id comment", author: "Test" });
  const visibleComment = saveComment({ issue_id: "SAV-900001", body: "Visible identifier comment", author: "Agent" });
  assert(visibleComment.id !== oldComment.id, "saveComment returned an unrelated null-external-id comment");
  assert(visibleComment.issue_id === migrated.id, "saveComment did not resolve a visible issue identifier");
  const createdWithComments = getIssue(created.identifier);
  const migratedWithComments = getIssue("SAV-900001");
  assert(createdWithComments.comments.length === 1, "getIssue returned comments from another issue");
  assert(createdWithComments.comments[0].id === oldComment.id, "getIssue returned the wrong comment for the original issue");
  assert(migratedWithComments.comments.length === 1, "getIssue missed the migrated issue comment or included extras");
  assert(migratedWithComments.comments[0].id === visibleComment.id, "getIssue returned the wrong comment for the migrated issue");
  const firstExternalComment = saveComment({
    issue_id: "SAV-900001",
    external_id: "agent-run-comment-1",
    body: "First idempotent body",
    author: "Agent A",
    source: "test",
  });
  const updatedExternalComment = saveComment({
    issue_id: "SAV-900001",
    external_id: "agent-run-comment-1",
    body: "Updated idempotent body",
    author: "Agent B",
    source: "test",
  });
  const externalCommentCount = db.prepare("SELECT COUNT(*) AS count FROM comments WHERE external_id = 'agent-run-comment-1'").get().count;
  assert(updatedExternalComment.id === firstExternalComment.id, "saveComment external_id did not update the same row");
  assert(externalCommentCount === 1, `saveComment external_id created duplicates: ${externalCommentCount}`);
  assert(updatedExternalComment.body === "Updated idempotent body", "saveComment external_id did not update body");
  assert(updatedExternalComment.author === "Agent B", "saveComment external_id did not update author");
  assert(updatedExternalComment.issue_id === migrated.id, "saveComment external_id did not stay attached to the resolved issue");
  let invalidIssueMessage = "";
  try {
    saveComment({ issue_id: "CTH-DOES-NOT-EXIST", body: "Nope" });
  } catch (error) {
    invalidIssueMessage = error instanceof Error ? error.message : String(error);
  }
  assert(invalidIssueMessage === "Issue not found: CTH-DOES-NOT-EXIST", `invalid issue error was not clear: ${invalidIssueMessage}`);

  const claimTarget = upsertIssue({ title: "Agent claim target", identifier: "CTH-900006", status: "Todo" });
  const sessionA = startAgentSession({ id: "session-agent-a", agent_name: "Agent A", harness: "Codex", ttl_minutes: 30, metadata: { thread: "alpha" } });
  assert(sessionA.id === "session-agent-a", "startAgentSession did not preserve requested id");
  assert(sessionA.metadata.thread === "alpha", "startAgentSession did not hydrate metadata");
  const heartbeat = heartbeatAgentSession({ session_id: "session-agent-a", ttl_minutes: 45 });
  assert(heartbeat.expires_at >= sessionA.expires_at, "heartbeatAgentSession did not renew the session");
  const firstClaim = claimIssue({ issue_id: "CTH-900006", session_id: "session-agent-a", note: "first pass", ttl_minutes: 30 });
  assert(firstClaim.claim.issue_id === claimTarget.id, "claimIssue did not resolve visible issue identifier");
  assert(firstClaim.idempotent === false, "first claim should not be idempotent");
  const renewedClaim = claimIssue({ issue_id: "CTH-900006", session_id: "session-agent-a", note: "renewed", ttl_minutes: 30 });
  assert(renewedClaim.claim.id === firstClaim.claim.id, "claimIssue did not renew the existing claim for the same session");
  assert(renewedClaim.idempotent === true, "same-session claim should be idempotent");
  assert(renewedClaim.claim.note === "renewed", "same-session claim did not update the note");
  startAgentSession({ id: "session-agent-b", agent_name: "Agent B", harness: "Claude Code", ttl_minutes: 30 });
  let conflictMessage = "";
  try {
    claimIssue({ issue_id: "CTH-900006", session_id: "session-agent-b" });
  } catch (error) {
    conflictMessage = error instanceof Error ? error.message : String(error);
  }
  assert(conflictMessage.includes("Issue already claimed by Agent A"), `claim conflict was not clear: ${conflictMessage}`);
  const forcedClaim = claimIssue({ issue_id: "CTH-900006", session_id: "session-agent-b", force: true, note: "takeover" });
  assert(forcedClaim.forced === true, "force claim did not report forced takeover");
  assert(forcedClaim.claim.agent_name === "Agent B", "force claim did not move ownership to Agent B");
  assert(listIssueClaims({ issue_id: "CTH-900006" }).length === 1, "listIssueClaims should show only one active claim");
  const completedClaim = releaseIssueClaim({ issue_id: "CTH-900006", session_id: "session-agent-b", status: "completed" });
  assert(completedClaim.released === true, "releaseIssueClaim did not release active claim");
  assert(completedClaim.claim.status === "completed", "releaseIssueClaim did not store completed status");
  assert(listIssueClaims({ issue_id: "CTH-900006" }).length === 0, "default listIssueClaims returned a completed claim as active by issue");
  assert(!listIssueClaims({ session_id: "session-agent-b" }).some((claim) => claim.id === completedClaim.claim.id), "default listIssueClaims returned a completed claim as active by session");
  assert(!listIssueClaims().some((claim) => claim.id === completedClaim.claim.id), "default listIssueClaims returned a completed claim as active globally");
  assert(
    !listIssueClaims({ issue_id: "CTH-900006", include_released: "false" }).some((claim) => claim.id === completedClaim.claim.id),
    "include_released:\"false\" returned a completed claim as active",
  );
  assert(
    listIssueClaims({ issue_id: "CTH-900006", include_released: "true" }).some((claim) => claim.id === completedClaim.claim.id && claim.status === "completed" && claim.released_at),
    "include_released:\"true\" did not show completed claim history",
  );

  const claimIdReleaseTarget = upsertIssue({ title: "Claim id release target", identifier: "CTH-900016", status: "Todo" });
  const claimIdClaim = claimIssue({ issue_id: claimIdReleaseTarget.identifier, session_id: "session-agent-a", ttl_minutes: 30 });
  const claimIdRelease = releaseIssueClaim({ claim_id: claimIdClaim.claim.id, status: "completed" });
  assert(claimIdRelease.released === true, "releaseIssueClaim did not release by claim_id");
  assert(claimIdRelease.claim.id === claimIdClaim.claim.id, "releaseIssueClaim by claim_id released the wrong claim");
  assert(claimIdRelease.claim.status === "completed", "releaseIssueClaim by claim_id did not store completed status");
  assert(listIssueClaims({ issue_id: claimIdReleaseTarget.identifier }).length === 0, "releaseIssueClaim by claim_id left an active claim visible");

  const wrongClaimSessionTarget = upsertIssue({ title: "Wrong claim id session target", identifier: "CTH-900017", status: "Todo" });
  const wrongClaimSession = claimIssue({ issue_id: wrongClaimSessionTarget.identifier, session_id: "session-agent-a", ttl_minutes: 30 });
  let wrongClaimSessionMessage = "";
  try {
    releaseIssueClaim({ claim_id: wrongClaimSession.claim.id, session_id: "session-agent-b" });
  } catch (error) {
    wrongClaimSessionMessage = error instanceof Error ? error.message : String(error);
  }
  assert(wrongClaimSessionMessage.includes("Issue claim belongs to session-agent-a"), `wrong claim_id session release did not fail clearly: ${wrongClaimSessionMessage}`);
  assert(listIssueClaims({ issue_id: wrongClaimSessionTarget.identifier }).length === 1, "wrong claim_id session release mutated the active claim without force");
  const forcedClaimIdRelease = releaseIssueClaim({ claim_id: wrongClaimSession.claim.id, session_id: "session-agent-b", force: "true" });
  assert(forcedClaimIdRelease.released === true, "force release by claim_id did not release the active claim");
  assert(listIssueClaims({ issue_id: wrongClaimSessionTarget.identifier }).length === 0, "force release by claim_id left active claims visible");

  const staleReleaseTarget = upsertIssue({ title: "Stale newest claim release target", identifier: "CTH-900013", status: "Todo" });
  db.prepare(`
    INSERT INTO issue_claims (id, issue_id, session_id, agent_name, status, note, claimed_at, heartbeat_at, expires_at, released_at, force)
    VALUES
      ('claim-real-active-release', @issue_id, 'session-agent-a', 'Agent A', 'active', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z', NULL, 0),
      ('claim-stale-newest-release', @issue_id, 'session-agent-b', 'Agent B', 'active', NULL, '2999-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', NULL, 0)
  `).run({ issue_id: staleReleaseTarget.id });
  const staleRelease = releaseIssueClaim({ issue_id: staleReleaseTarget.identifier, session_id: "session-agent-a", status: "completed" });
  assert(staleRelease.claim.id === "claim-real-active-release", "releaseIssueClaim released stale newest row instead of the live active row");
  assert(listIssueClaims({ issue_id: staleReleaseTarget.identifier }).length === 0, "releaseIssueClaim left a stale release target active");
  assert(
    listIssueClaims({ issue_id: staleReleaseTarget.identifier, include_released: true }).some((claim) => claim.id === "claim-stale-newest-release" && claim.status === "expired"),
    "releaseIssueClaim did not expire stale unreleased rows before release",
  );

  const wrongSessionTarget = upsertIssue({ title: "Wrong session release target", identifier: "CTH-900014", status: "Todo" });
  claimIssue({ issue_id: wrongSessionTarget.identifier, session_id: "session-agent-a", ttl_minutes: 30 });
  let wrongSessionMessage = "";
  try {
    releaseIssueClaim({ issue_id: wrongSessionTarget.identifier, session_id: "session-agent-b", force: "false" });
  } catch (error) {
    wrongSessionMessage = error instanceof Error ? error.message : String(error);
  }
  assert(wrongSessionMessage.includes("Issue claim belongs to session-agent-a"), `wrong-session release did not fail clearly: ${wrongSessionMessage}`);
  assert(listIssueClaims({ issue_id: wrongSessionTarget.identifier }).length === 1, "wrong-session release mutated the active claim without force");
  const forcedWrongSessionRelease = releaseIssueClaim({ issue_id: wrongSessionTarget.identifier, session_id: "session-agent-b", force: "true" });
  assert(forcedWrongSessionRelease.released === true, "force release did not release the active claim");
  assert(listIssueClaims({ issue_id: wrongSessionTarget.identifier }).length === 0, "force release left active claims visible");

  const duplicateActiveTarget = upsertIssue({ title: "Duplicate active claim release target", identifier: "CTH-900015", status: "Todo" });
  db.prepare(`
    INSERT INTO issue_claims (id, issue_id, session_id, agent_name, status, note, claimed_at, heartbeat_at, expires_at, released_at, force)
    VALUES
      ('claim-duplicate-active-a', @issue_id, 'session-agent-a', 'Agent A', 'active', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z', NULL, 0),
      ('claim-duplicate-active-b', @issue_id, 'session-agent-b', 'Agent B', 'active', NULL, '2026-01-01T00:00:01.000Z', '2026-01-01T00:00:01.000Z', '2999-01-01T00:00:00.000Z', NULL, 0)
  `).run({ issue_id: duplicateActiveTarget.id });
  const duplicateRelease = releaseIssueClaim({ issue_id: duplicateActiveTarget.identifier, session_id: "session-agent-a", status: "completed" });
  assert(duplicateRelease.claim.id === "claim-duplicate-active-a", "duplicate-active release did not release the intended session");
  assert(duplicateRelease.superseded_active_duplicates === 1, "duplicate-active release did not report repairing the duplicate");
  assert(listIssueClaims({ issue_id: duplicateActiveTarget.identifier }).length === 0, "duplicate-active release left another active claim visible");
  assert(
    listIssueClaims({ issue_id: duplicateActiveTarget.identifier, include_released: true }).some((claim) => claim.id === "claim-duplicate-active-b" && claim.status === "superseded"),
    "duplicate-active release did not supersede the duplicate active claim",
  );

  const expiryTarget = upsertIssue({ title: "Expired claim target", identifier: "CTH-900007", status: "Todo" });
  const expiringClaim = claimIssue({ issue_id: expiryTarget.identifier, session_id: "session-agent-a", ttl_minutes: 30 });
  db.prepare("UPDATE issue_claims SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = @id").run({ id: expiringClaim.claim.id });
  assert(listIssueClaims({ issue_id: expiryTarget.identifier }).length === 0, "default listIssueClaims returned an expired claim as active");
  assert(
    listIssueClaims({ issue_id: expiryTarget.identifier, include_released: true }).some((claim) => claim.id === expiringClaim.claim.id),
    "historical listIssueClaims did not include the manually expired claim",
  );
  const afterExpiry = claimIssue({ issue_id: expiryTarget.identifier, session_id: "session-agent-b" });
  assert(afterExpiry.expired_released === 1, "claimIssue did not expire the stale claim before taking over");
  db.prepare("UPDATE agent_sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = 'session-agent-a'").run();
  assert(!listAgentSessions().some((session) => session.id === "session-agent-a"), "default listAgentSessions returned an expired session as active");
  assert(listAgentSessions({ include_ended: true }).some((session) => session.id === "session-agent-a"), "historical listAgentSessions did not include expired session");
  endAgentSession({ session_id: "session-agent-b" });
  assert(listIssueClaims({ session_id: "session-agent-b" }).length === 0, "endAgentSession did not release active claims by default");
  assert(listAgentSessions({ include_ended: true }).some((session) => session.id === "session-agent-b" && session.status === "ended"), "ended session was not listed");

  const dirtyUpdatedAt = "2026-05-14T10:00:00.000Z";
  db.prepare(`
    INSERT INTO issues (id, identifier, title, description, status, status_type, priority, team_id, labels, source, created_at, updated_at)
    VALUES (@id, @identifier, @title, @description, @status, @status_type, @priority, @team_id, @labels, @source, @created_at, @updated_at)
  `).run({
    id: "dirty_done_issue",
    identifier: "CTH-900005",
    title: "Dirty Done issue",
    description: "Raw legacy row with stale status_type and double-encoded labels.",
    status: "Done",
    status_type: "backlog",
    priority: 2,
    team_id: "team_local",
    labels: JSON.stringify(JSON.stringify(["theme", "security"])),
    source: "local",
    created_at: dirtyUpdatedAt,
    updated_at: dirtyUpdatedAt,
  });
  const repair = repairIssueInvariants();
  assert(repair.issuesChecked >= 1, "repair did not scan issues");
  assert(repair.statusTypeFixed >= 1, "repair did not fix stale status_type");
  assert(repair.completedAtFixed >= 1, "repair did not set completed_at");
  assert(repair.labelsFixed >= 1, "repair did not normalize labels");
  assert(repair.issuesChanged >= 1, "repair did not report changed issues");
  const rawDirty = db.prepare("SELECT status_type, completed_at, labels FROM issues WHERE id = 'dirty_done_issue'").get();
  assert(rawDirty.status_type === "completed", `raw status_type was not repaired: ${rawDirty.status_type}`);
  assert(rawDirty.completed_at === dirtyUpdatedAt, `completed_at should use updated_at as historical proxy: ${rawDirty.completed_at}`);
  assert(rawDirty.labels === JSON.stringify(["theme", "security"]), `raw labels were not canonicalized: ${rawDirty.labels}`);
  const secondRepair = repairIssueInvariants();
  assert(secondRepair.statusTypeFixed === 0, "repair is not idempotent for status_type");
  assert(secondRepair.completedAtFixed === 0, "repair is not idempotent for completed_at");
  assert(secondRepair.labelsFixed === 0, "repair is not idempotent for labels");
  assert(secondRepair.issuesChanged === 0, "repair is not idempotent for changed issue count");
  db.close();
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log("Store regression passed");
