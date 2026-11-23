# Project membership, assignment and reliable collaboration

## Project members

All routes require a valid bearer token. Tenant identity comes from the authenticated organization membership.

- `GET /api/v1/projects/:projectId/members` — list project members.
- `GET /api/v1/projects/:projectId/members/eligible` — list active organization users not yet on the project.
- `POST /api/v1/projects/:projectId/members` — owner/admin/project_manager only. Body: `{"userId":"<user-id>","role":"contributor"}`. Roles: `project_manager`, `contributor`, `viewer`.
- `PATCH /api/v1/projects/:projectId/members/:memberId` — owner/admin/project_manager only. Update role and/or status (`active`, `inactive`).

A newly created project's creator is automatically added as its first project manager. A project member must already have an active membership in the same organization. Compound unique indexes prevent duplicate project memberships.

## Explicit task assignment

Work item create/update accepts optional `assignedUserId`. It must identify an active member of the same project. Existing free-text `assignedTo` remains supported for backward compatibility. New assignments enqueue a targeted `tasks.assigned` event; the notification is delivered only to the assigned project member.

## Reliable event delivery

Event-producing domain workflows use `runProjectMutationWithEvent`. On a replica set or sharded cluster, the domain write(s) and outbox insert run in one MongoDB transaction with snapshot reads and majority write concern; transaction retries use Mongoose `Connection#transaction` so document state is reset on abort/retry. The API process runs a polling worker that claims pending events using an atomic lease, writes append-only activity with a unique source-event key, upserts notifications with a unique activity/recipient key, and marks delivery complete. Failed deliveries retry with exponential backoff (one minute up to one hour), up to eight attempts; exhausted records remain inspectable with a bounded error message in the outbox collection. The worker lease allows recovery after a process crash and prevents concurrent workers from claiming the same unexpired event. Each claim also carries a unique fencing token; completion and retry updates must match the current token, so a worker that resumes after its lease was taken over cannot overwrite the newer worker's state.

Events cover task assignment; commercial record creation/status; inspection, NCR, CAPA and safety-event creation/status; RFI and submittal lifecycle; and document creation, version additions and approval decisions. Summaries intentionally exclude document contents, reviewer comments, incident narratives and other sensitive payload fields. Events fan out to active project members, excluding the actor. Explicit recipients (task assignment) are intersected with active project membership. The activity feed is tenant/project scoped; non-manager members must have active membership to read it.

## Operational boundaries

Set `OUTBOX_TRANSACTION_MODE=required` in production to make startup fail unless the connected MongoDB topology advertises replica-set or mongos transaction support. `auto` (the default for local compatibility) detects topology at startup; on standalone MongoDB it logs a warning and uses a non-atomic fallback. In fallback mode, a domain write can commit before an enqueue error is returned, so an event can still be omitted; the readiness endpoint reports `non_atomic_fallback`. `disabled` explicitly opts out. For production deployments, use a replica set or sharded cluster and `required` mode.

Failed records are visible through `GET /api/v1/projects/:projectId/collaboration/outbox/failed` and can be re-queued through `POST /api/v1/projects/:projectId/collaboration/outbox/:eventId/replay`. These endpoints require an organization owner, admin, or project-manager role and scope every operation by the authenticated organization and project. Replay resets attempts and records the replay actor/time/count.

Socket.IO was not introduced. The existing HTTP server has no established socket authentication/subscription lifecycle; a socket layer would require authenticated handshake token verification, per-project membership authorization on room join, and revocation handling. Persisted delivery remains the safe default; the web inbox refreshes via HTTP.

CI provisions MongoDB 7 as a single-node replica set and runs HTTP/JWT tests for inbox ownership, notification read ownership, project activity membership, inactive/non-member denial, cross-tenant project denial, project-member role restrictions, same-tenant member addition, task assignment, safety-event and commercial event creation, failed-event replay authorization, plus transaction commit/rollback and outbox worker recovery/idempotency. Activity records are append-only through Mongoose document/query APIs; database administrators with direct collection privileges can still modify or delete records. This is not a cryptographically tamper-evident ledger.
