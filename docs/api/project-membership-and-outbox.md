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

Domain workflows enqueue allowlisted collaboration events into `CollaborationOutbox`. The API process runs a polling worker that claims pending events using an atomic lease, writes activity with a unique source-event key, upserts notifications with a unique activity/recipient key, and marks delivery complete. Failed deliveries retry with exponential backoff (one minute up to one hour), up to eight attempts; exhausted records remain inspectable with a bounded error message in the outbox collection. The worker lease allows recovery after a process crash and prevents concurrent workers from claiming the same unexpired event.

Events fan out to active project members, excluding the actor. Explicit recipients (task assignment) are intersected with active project membership. The activity feed is tenant/project scoped; non-manager members must have active membership to read it.

## Operational boundaries

This outbox is durable after its enqueue write succeeds and its delivery steps are idempotent. It is not yet a transactional outbox with the source domain mutation: a process/database failure between the domain write and enqueue can still omit an event. MongoDB replica-set transactions or an atomic domain-write/outbox transaction are the next reliability improvement. Failed outbox records need an operator retry/replay interface.

Socket.IO was not introduced. The existing HTTP server has no established socket authentication/subscription lifecycle; a socket layer would require authenticated handshake token verification, per-project membership authorization on room join, and revocation handling. Persisted delivery remains the safe default; the web inbox refreshes via HTTP.

CI runs MongoDB-backed tests for tenant/project/recipient query isolation and notification ownership. These exercise database filters directly; full HTTP/JWT authorization integration tests and end-to-end workflow tests remain outstanding.
