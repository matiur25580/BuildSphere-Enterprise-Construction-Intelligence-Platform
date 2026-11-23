# Collaboration, notifications and activity API

All routes require a valid bearer access token. Organization identity and recipient identity are derived from the authenticated membership; request bodies cannot choose an actor or tenant.

## Notifications

- `GET /api/v1/notifications?limit=20&page=1` — authenticated user's inbox, newest first. Limit is 1–50; page starts at 1.
- `GET /api/v1/notifications/unread-count` — unread count for the authenticated user in the active organization.
- `PATCH /api/v1/notifications/read` — body: `{"notificationIds":["<24-character-object-id>"]}`; mark up to 50 notifications as read. Only rows belonging to both the active organization and authenticated recipient are modified. IDs belonging to another user or organization are ignored.

## Project activity

- `GET /api/v1/projects/:projectId/collaboration/activity?limit=20&page=1` — append-only project event feed. Project ownership is verified against the authenticated organization. Actor display names are populated from the user record.

## Event coverage

The API emits safe summaries for commercial record creation/status changes; quality inspection and NCR/CAPA creation/status changes; safety event reporting; RFI and submittal creation/submission/response/review; and document creation/approval changes. The event type is an application allowlist. Notification payloads contain summary, event type and a reference to the activity target, not document contents, private notes, or file URLs.

Notifications are fanned out to active organization memberships except the actor. There is no per-project membership model yet, so this is organization-level visibility for projects within that tenant.

## Delivery semantics and limitations

The event is recorded after the underlying domain mutation. The current safe publisher logs failures rather than returning a false failure after the domain write has committed. This is not transactional: a database outage between the domain write and activity/notification persistence can lose an event. A MongoDB transactional outbox with retries and idempotency is needed for guaranteed delivery. Socket.IO is not enabled; clients refresh the persisted inbox. Activity records are append-only at the application API level but not protected by a tamper-evident ledger.

Unit tests cover tenant/recipient scope construction and event allowlisting. They do not replace MongoDB-backed cross-tenant endpoint integration tests.
