# Field operations API

All endpoints require an authenticated bearer access token. Tenant and project scope are derived from the authenticated membership and `:projectId`; clients cannot supply an organization ID.

Base path: `/api/v1/projects/:projectId/field`

## Contractors
- `GET /contractors` — list contractors registered to the project.
- `POST /contractors` — create a contractor (owner, admin, project_manager).
- `PATCH /contractors/:contractorId` — update contact details, notes, or status (owner, admin, project_manager).

Contractor fields include company name, trade, contact name, email, phone, notes, and status (`active`, `suspended`, `completed`). A contractor is project-scoped and unique by company and trade within the project.

## Daily site reports
- `GET /daily-reports` — list the latest 100 reports.
- `POST /daily-reports` — submit a day or night shift report (owner, admin, project_manager).
- `GET /summary` — contractor, report, workforce, equipment-hour, and latest progress summary.

Reports capture date and shift, weather, work performed, progress percentage, workforce by trade and contractor, equipment quantity and hours, safety observations, delays/issues, photo evidence references, and optional site/photo coordinates. A project may have one report per date and shift. Report dates must fall within the project schedule.

Photo references must be HTTPS URLs. This milestone stores evidence metadata and references; it does not upload or host image files. Use an authenticated object-storage upload flow before accepting untrusted user content in a production deployment.

## Operational boundary
This is a first field-operations workflow, not a complete workforce payroll, equipment telematics, offline synchronization, or safety incident-management system. Add upload authorization, audit history, report amendments, geospatial validation, offline conflict handling, and dedicated safety workflows before production site rollout.
