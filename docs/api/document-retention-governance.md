# Document retention and legal-hold governance

All routes are scoped to the authenticated organization and project and require active project membership with project-manager, owner, or admin authority.

## Retention policy

- `GET /api/v1/projects/:projectId/delivery/document-governance/retention` reads the project policy.
- `PUT /api/v1/projects/:projectId/delivery/document-governance/retention` sets `enabled`, `retentionDays` (365–36,500), `minimumVersions` (1–100), and `reviewBeforePurgeDays` (1–365).
- `GET /api/v1/projects/:projectId/delivery/document-governance/retention/evaluation` evaluates aged versions against the policy and active legal holds.

Retention is disabled until explicitly configured. Default policy values are seven years, one preserved version per document, and a 30-day review lead. Evaluation is read-only: it reports records eligible for human review and never deletes metadata or objects. The newest configured number of versions is retained regardless of age.

## Legal holds

- `GET /api/v1/projects/:projectId/delivery/document-governance/legal-holds` lists active and released holds.
- `POST /api/v1/projects/:projectId/delivery/documents/:documentId/legal-holds` places a hold with a case/reference and reason.
- `POST /api/v1/projects/:projectId/delivery/documents/:documentId/legal-holds/:holdId/release` releases an active hold with a mandatory explanatory comment.

Only one active hold may be placed on a document at a time. A hold protects every binary asset for that document from appearing in the retention review candidate list. Placement and release are recorded in a separate append-only application event stream and in the collaboration outbox.

## Safety and operational boundary

This milestone introduces policy and hold records plus a read-only retention evaluation. It intentionally does not perform automatic or manual physical deletion, alter historical document versions, or claim legal compliance. A future purge workflow must add dual approval, a second hold check at execution time, an immutable deletion manifest, a grace period, backup/restore validation, and jurisdiction-specific policy review. The existing storage inventory reconciler already preserves every object referenced by a DocumentAsset; legal holds further protect records from future retention workflows. Configure retention values with qualified legal and records-management stakeholders.
