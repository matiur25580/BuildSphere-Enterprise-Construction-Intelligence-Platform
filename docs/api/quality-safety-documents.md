# Quality, safety, documents and approvals API

All routes are mounted under `/api/v1/projects/:projectId/delivery`. Every request requires a bearer access token. The API derives `organizationId` from the active authenticated membership, verifies that the project belongs to that organization, and scopes every read and mutation to both organization and project. The client cannot choose tenant scope.

Mutation routes require an owner, admin, or project_manager role. Read routes require an authenticated active project tenant membership. Records are limited to the latest 100 results per register.

## Summary
- `GET /summary` — counts inspections, open NCRs/CAPA actions, open safety events/RFIs, pending submittals, documents, and pending document approvals.

## Quality inspections
- `GET /inspections`
- `POST /inspections` — create a checklist inspection with reference, title, area, inspection date, inspector, checklist items (`pass`, `fail`, `not_applicable`), and notes.
- `PATCH /inspections/:inspectionId/status` — submit, accept, or reject. Supported transitions: `draft -> submitted`, `submitted -> accepted|rejected`, `rejected -> submitted`.

## Non-conformance and CAPA
- `GET /ncrs`, `POST /ncrs`, `PATCH /ncrs/:ncrId/status`.
- `GET /ncrs/:ncrId/capa`, `POST /ncrs/:ncrId/capa`, `PATCH /capa/:capaId/status`.
- NCR statuses: `open -> under_review -> corrective_action -> verification -> closed`; verification can return to corrective action. Closure is blocked until all linked CAPA actions are verified. Closure notes and timestamp are retained.
- CAPA statuses: `open -> in_progress -> completed -> verified`. Completion requires completion notes. CAPA actions are typed corrective or preventive and include owner and due date.

## Safety
- `GET /safety-events`, `POST /safety-events`, `PATCH /safety-events/:eventId/status`.
- Events are hazards, near misses, or incidents with severity, occurred-at time, location, description, and immediate action. Status transitions: `reported -> under_review -> controls_assigned -> closed`.

## RFIs
- `GET /rfis`, `POST /rfis`, `PATCH /rfis/:rfiId/submit`, `PATCH /rfis/:rfiId/respond`.
- RFI records include a unique project reference, subject, question, discipline, due date, response, responder, and response timestamp. Transitions: `draft -> submitted -> responded -> closed`.

## Submittals
- `GET /submittals`, `POST /submittals`, `PATCH /submittals/:submittalId/submit`, `PATCH /submittals/:submittalId/review`.
- Track revision, specification section, due date, reviewer response and reviewer identity. Review outcomes include `approved`, `approved_as_noted`, `rejected`, and `resubmit`.

## Controlled documents
- `GET /documents`, `POST /documents`, `POST /documents/:documentId/versions`, `PATCH /documents/:documentId/approval`.
- Document numbers are unique within a project. Each document retains version number, HTTPS file reference, filename, optional checksum, notes, uploader and upload timestamp. Approval actions (`submitted`, `approved`, `rejected`, `revision_requested`) are appended to an embedded history with actor, comment and timestamp.
- A new version is blocked while approval is pending or approved. Adding a version increments the version and returns the document to draft. Approval is permitted only after submission.

## Security and operational boundaries
- All document URLs must use HTTPS, but this milestone stores references; it does not upload, scan, virus-check, authorize or serve the underlying binary. Production should integrate short-lived signed object-storage URLs, content-type/size checks, malware scanning, and access-control enforcement.
- Approval history is append-only through these endpoints, but is not a tamper-evident audit ledger. No separate event store, notifications, delegation, SLA escalation, e-signatures, offline conflict handling, or granular discipline-specific permissions are implemented.
- Inspection checklist templates, photo attachments, drawing markup, formal permit-to-work, regulatory incident reporting, and document retention policies remain future work.
- Build currently has CI build verification; the repository does not yet define an API integration-test runner or test database. Add isolated tenant-boundary and transition tests before production rollout.
