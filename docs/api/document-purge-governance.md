# Controlled document purge governance

This milestone adds a request, dual-approval and manifest-preparation workflow on top of project retention evaluation and legal holds.

## Endpoints

All routes are project-scoped under `/api/v1/projects/:projectId/delivery` and require authentication plus active project membership. Project managers, owners and admins may use the workflow.

- `POST /document-governance/purge-requests` — submit a request with a reference, reason and 1–100 eligible asset IDs.
- `GET /document-governance/purge-requests` — list the latest 100 project requests.
- `POST /document-governance/purge-requests/:purgeRequestId/approvals` — record an approval with a comment.
- `POST /document-governance/purge-requests/:purgeRequestId/prepare` — run the final safety checks and prepare a deletion manifest.

## Approval and safety rules

- Retention must be enabled and every requested asset must be in the current read-only retention evaluation.
- Requests expire after seven days.
- The requester cannot approve their own request.
- Exactly two distinct project managers/owners/admins must approve; each approval requires a substantive comment.
- Candidate identity is snapshotted (asset/document IDs, version, storage key, SHA-256 and size) and revalidated before manifest preparation.
- Immediately before preparation, retention eligibility is recalculated and active legal holds are queried again. A hold, changed/missing asset, or loss of eligibility blocks preparation.
- The manifest is content-hashed and stored with the request; governance events are appended for request, approvals and manifest preparation.

## Deliberate deletion boundary

This milestone **does not delete document metadata or storage objects**. A prepared manifest is an auditable, dual-approved purge plan only. Irreversible deletion remains disabled until a separate executor provides quarantining, restore verification, retention of backups, idempotent storage deletion, and a post-delete audit trail. No automated worker consumes prepared manifests.
