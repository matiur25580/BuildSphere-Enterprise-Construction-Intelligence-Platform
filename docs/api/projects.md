# Project portfolio API

All routes require a valid bearer access token. Project and work-item queries are scoped to the organization resolved from the authenticated membership; clients cannot select a tenant by sending an organization ID.

## Projects

- `GET /api/v1/projects` — list the current organization's projects with work-item counts.
- `POST /api/v1/projects` — create a project (owner, admin, project_manager).
- `GET /api/v1/projects/:projectId` — project details and schedule items.
- `PATCH /api/v1/projects/:projectId` — update project metadata/status (owner, admin, project_manager).

Creation fields: `code`, `name`, `startDate`, `targetEndDate`; optional description, clientName, location, budget, currency. End date cannot precede start date. Project codes are unique per organization.

## Work breakdown and schedule

- `GET /api/v1/projects/:projectId/work-items`
- `POST /api/v1/projects/:projectId/work-items`
- `PATCH /api/v1/projects/:projectId/work-items/:itemId`

Work items support `summary`, `task`, and `milestone` types; parent summary links; date ranges; status; progress; assignee labels; and predecessor references. A work item's parent and predecessors must belong to the same project and organization. Dates must fit within the project range at creation.

## Current limitations

This milestone provides a practical WBS and schedule data foundation. It does not yet calculate critical path, detect dependency cycles across a graph, implement resource assignment records, or render a full Gantt chart. Those are follow-on schedule-engine tasks.
