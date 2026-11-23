# Collaboration, notifications and activity API

All routes require a valid bearer access token. Organization identity, actor identity and notification recipient identity are derived from the authenticated membership; request bodies cannot choose an actor or tenant.

## Notifications

- `GET /api/v1/notifications?limit=20&page=1` — authenticated user's inbox, newest first. Limit is 1–50; page starts at 1.
- `GET /api/v1/notifications/unread-count` — unread count for the authenticated user in the active organization.
- `PATCH /api/v1/notifications/read` — body: `{"notificationIds":["<24-character-object-id>"]}`; mark up to 50 notifications as read. Only rows belonging to both the active organization and authenticated recipient are modified. IDs belonging to another user or organization are ignored.

## Project activity

- `GET /api/v1/projects/:projectId/collaboration/activity?limit=20&page=1` — append-only project event feed. Project ownership is verified against the authenticated organization. Owner/admin/project-manager roles may read the project feed; other users must have active project membership.

## Event coverage

The allowlisted events cover task assignment; commercial record creation/status changes; quality inspection and NCR/CAPA creation/status changes; safety event reporting/status changes; RFI and submittal creation/submission/response/review; and document creation/version additions/approval decisions. The event actor is the authenticated user. Notification summaries are intentionally concise and exclude document contents, file URLs, reviewer comments, incident narratives and private notes.

Notifications are delivered to active project members, excluding the actor. Explicit assignment recipients are intersected with active project membership. Project roster administration and assignment validation are documented in [Project membership and outbox](project-membership-and-outbox.md).

## Delivery semantics and limitations

On transaction-capable MongoDB topologies, event-producing domain mutations and outbox inserts commit in the same MongoDB transaction. The polling worker claims events with atomic leases and unique fencing tokens; a worker whose lease has been taken over cannot update the newer worker's delivery/retry state. Activity records are append-only at the application model layer and keyed by unique source event; recipient notification upserts are idempotent. Failures retry with exponential backoff for up to eight attempts.

Configure `OUTBOX_TRANSACTION_MODE=required` for production. Startup verifies MongoDB `hello` topology metadata and fails if neither replica-set nor mongos transaction support is available. `auto` detects topology and falls back on standalone MongoDB with an explicit warning; in that non-atomic fallback, the domain write may commit even if enqueue fails. The readiness endpoint exposes `collaborationOutboxTransactions` as `enabled`, `non_atomic_fallback`, or `unverified`. `disabled` explicitly selects the fallback. Use a replica set or sharded cluster for transactional guarantees.

Owners, admins and project managers can inspect failed events at `GET /api/v1/projects/:projectId/collaboration/outbox/failed` and replay a scoped failed event with `POST /api/v1/projects/:projectId/collaboration/outbox/:eventId/replay`. Replay resets attempts and records operator/time/count. Socket.IO delivery remains deferred.

CI runs a MongoDB 7 replica set and exercises transaction commit/rollback, expired lease recovery, idempotent worker retries, HTTP/JWT tenant and recipient isolation, project membership and role checks, task assignment, safety/commercial event-producing routes, failed-event replay authorization and append-only model behavior. Activity is application-level append-only; direct database privileges can still alter records, so this is not a tamper-evident ledger.
