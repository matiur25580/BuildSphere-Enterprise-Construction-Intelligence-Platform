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

Events are enqueued after the underlying domain mutation. The polling worker claims events with atomic leases and unique fencing tokens; a worker whose lease has been taken over cannot update the newer worker's delivery/retry state. Activity and recipient notification upserts are idempotent. Failures retry with exponential backoff for up to eight attempts.

This is not yet a transactional outbox: a process/database failure between a domain write and the subsequent enqueue can still omit an event. The enqueue helper is best-effort so a committed business mutation is not reported as failed solely because notification enqueue failed. A MongoDB transaction spanning each domain mutation and its outbox insert is required to close that gap. Failed-event operator replay, full HTTP/JWT authorization integration tests, and Socket.IO delivery remain follow-up work.

CI runs MongoDB-backed tests for tenant/project/recipient filtering, notification ownership and stale worker fencing, plus unit tests for scopes, allowlisted events and retry/fencing policy. These tests do not replace full end-to-end authorization tests. Activity records are append-only at the application API level, not a tamper-evident ledger.
