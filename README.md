# BuildSphere

**Enterprise Construction Intelligence & Project Delivery Platform**

BuildSphere is an AI-assisted construction operations platform designed to connect project planning, commercial control, field execution, quality, safety, and delivery intelligence in one workspace.

> Project status: active development. The foundation, authentication, project portfolio, commercial management, field operations, and first quality/safety/document-control workflows are implemented; broader capabilities are being delivered incrementally.

## Product direction

- Project portfolio, work breakdown structures, dependencies, milestones, and schedule visibility.
- Budget, commitments, procurement, invoices, and cash-flow controls.
- Contractor coordination and field reporting.
- Quality inspections, non-conformance workflows, safety observations, and corrective actions.
- RFIs, submittals, change orders, approvals, and versioned project documents.
- Evidence-led AI assistance for schedule risk, cost risk, and project reporting.
- Enterprise organizations, role-based access, audit trails, and tenant isolation.

## Technology

- **Frontend:** React, TypeScript, Vite.
- **Backend:** Node.js, Express, TypeScript.
- **Data:** MongoDB with Mongoose.
- **Client data:** Redux Toolkit and TanStack Query (planned for feature workflows).
- **Validation:** Zod.
- **Authentication:** bcrypt password hashing, short-lived JWT access tokens, rotating opaque refresh sessions, HttpOnly cookies.
- **UI:** responsive sign-in and organization registration experience.

## Repository structure

```text
apps/
  api/          Express API and domain modules
  web/          React web application
packages/
  shared/       Shared contracts and constants
docs/
  architecture/
  api/
  security/
infrastructure/
```

## Getting started

### Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- MongoDB 7 or newer (local or hosted)

### Setup

1. Clone the repository.
2. Copy `.env.example` to the repository-root `.env` (the API loads this file when started from the workspace root).
3. Set `MONGODB_URI`, `CLIENT_URL`, and a unique `JWT_ACCESS_SECRET` (at least 32 characters).
4. Install workspace dependencies from the repository root:

   ```bash
   npm install
   ```

5. Start the API and web application:

   ```bash
   npm run dev
   ```

6. Open the web app at http://localhost:5173.
7. Check API health at http://localhost:5000/api/v1/health.

Never commit real credentials or `.env` files. The root `.gitignore` excludes them.

## Authentication endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/v1/auth/register` | Create account and organization |
| POST | `/api/v1/auth/login` | Sign in |
| POST | `/api/v1/auth/refresh` | Rotate refresh session |
| POST | `/api/v1/auth/logout` | Revoke refresh session |
| GET | `/api/v1/auth/me` | Read authenticated user and organization |

See [Authentication API](docs/api/authentication.md) and [Authentication Security](docs/security/authentication.md).

## Engineering principles

- Secure by default; validate input at API boundaries.
- Enforce organization isolation on the server for every tenant-owned resource.
- Keep business rules in domain services, not controllers.
- Make important mutations auditable.
- Test authorization boundaries as well as happy paths.
- Prefer observable, documented workflows over placeholder feature breadth.

## Roadmap

1. Foundation and developer experience.
2. Authentication, organizations, memberships, and initial RBAC.
3. Project portfolio and schedule management.
4. Commercial management and procurement.
5. Contractor and field operations.
6. Quality, safety, documents, and approvals.
7. AI project intelligence and evidence-backed insights.
8. Security hardening, automated testing, and deployment.
9. Tenant-scoped collaboration, notifications and activity feed.
10. Project membership, task assignment and reliable collaboration.
11. Workflow-wide collaboration event coverage and worker fencing.

## Project portfolio milestone scope

Implemented: organization-scoped project creation/list/detail/update, project status and budget metadata, WBS summary/task/milestone records, parent summary links, predecessor references, work-item progress/status, project date validation, and a responsive portfolio dashboard with project creation. All project reads and writes derive organization scope from the authenticated session. See [Project Portfolio API](docs/api/projects.md).

Not yet implemented: full Gantt rendering, critical-path calculation, dependency-cycle detection, resource assignment entities, and schedule baselining.

## Commercial management milestone scope

Implemented: project cost codes and allocated budgets; purchase-order, invoice, and payment-claim records; cost-code linkage; record submission, approval, rejection, and payment status transitions; project commercial summaries; and a responsive commercial workspace.

This is an operational register, not a statutory accounting ledger. Decimal precision, immutable journals, tax, retention, partial-payment reconciliation, and audit events remain required before production financial use. See [Commercial Management API](docs/api/commercial-management.md).

## Field operations milestone scope

Implemented: project-scoped contractor registry, contractor contact/status updates, day/night daily site reports, workforce-by-trade and contractor logging, equipment quantity and hours, weather, progress, safety observations, delays/issues, HTTPS photo evidence references, optional site/photo coordinates, and field summary metrics. See [Field Operations API](docs/api/field-operations.md).

Not yet implemented: direct photo uploads/object storage, offline-first sync, payroll, equipment telemetry, formal safety incident workflows, and auditable report amendments.

## Quality, safety, documents and approvals milestone scope

Implemented: project-scoped quality inspections with checklist outcomes and review states; non-conformance reports with corrective/preventive action ownership, due dates and verification gates; hazard, near-miss and incident registers; RFI submission and response; submittal review outcomes; controlled project document records with numbered versions and approval history. All operations derive tenant scope from authenticated membership and validate project ownership. See [Quality, Safety, Documents and Approvals API](docs/api/quality-safety-documents.md).

Not yet implemented: binary uploads/object storage, malware scanning, immutable/tamper-evident audit ledger, notification/escalation, electronic signatures, offline workflows, regulatory incident submissions, and full integration-test infrastructure. Treat file URLs as references only; they are not proof of secure file access.

## AI project intelligence milestone scope

Implemented: explainable project risk signals across schedule, purchase-order commitments, overdue invoices, quality/NCR/CAPA, safety events, RFIs and submittals; project-currency checks; source-linked evidence register; and a tenant-scoped evidence query endpoint. The UI presents risk priorities, recommendations, evidence confidence labels and traceable records. See [Project Intelligence API](docs/api/project-intelligence.md).

Important: the current intelligence engine uses deterministic heuristics and keyword retrieval. It does not call an LLM, train a predictive model, calculate a critical path, or provide calibrated risk probabilities. It is a decision-support aid based only on recorded data, not a substitute for project controls review. Snapshot reads are bounded and generated on demand.

## Authentication milestone scope

Implemented: registration, login, password hashing, JWT access tokens, rotating refresh sessions, logout, authenticated profile, organization creation, owner membership, role middleware, and authentication rate limiting.

Not yet implemented: email verification, password reset delivery, MFA, organization switching, and membership administration. Do not treat this milestone as production-ready security without the testing and controls described in the security documentation.

See [Architecture Overview](docs/architecture/overview.md).


## Security hardening and deployment milestone

Implemented: exact CORS origin allowlisting (comma-separated `CLIENT_URL`), opt-in trusted-proxy configuration, UUID request correlation via `X-Request-Id`, a global API rate limit, 1 MB request-body limits, MongoDB readiness endpoint, security configuration unit tests, and a multi-stage non-root API Docker image. See [Production Readiness](docs/security/production-readiness.md).

The readiness endpoint is `GET /api/v1/ready`; liveness remains `GET /api/v1/health`. This repository milestone does not provision hosting or prove production readiness. MongoDB-backed cross-tenant integration tests, external security scanning, deployment secrets, telemetry export, and immutable audit storage remain outstanding.


## Collaboration, notifications and activity milestone

Implemented: append-only project activity and persisted recipient-scoped notifications for task assignment, commercial record creation/status, quality inspection and NCR/CAPA workflows, safety event creation/status, RFI/submittal lifecycle, and document registration/version/approval changes. Activity reads are tenant/project scoped; non-manager readers require active project membership. Notifications are restricted to the authenticated recipient and active tenant. The dashboard includes a team inbox, project roster and assignment controls.

API: `GET /api/v1/notifications`, `GET /api/v1/notifications/unread-count`, `PATCH /api/v1/notifications/read`, and `GET /api/v1/projects/:projectId/collaboration/activity`. See [Collaboration API](docs/api/collaboration.md) and [Project membership and outbox API](docs/api/project-membership-and-outbox.md).

Delivery guarantees depend on MongoDB topology. With replica-set or sharded-cluster transaction support, event-producing domain writes and outbox inserts commit atomically. Standalone MongoDB runs in an explicit non-atomic fallback unless `OUTBOX_TRANSACTION_MODE=required` is set; readiness reports the active mode. See Phase 12 and [Collaboration API](docs/api/collaboration.md).

## Phase 10 — Project membership, task assignment and reliable collaboration

BuildSphere now supports tenant-scoped project member management, with project manager/contributor/viewer roles and active/inactive membership. Project creators are bootstrapped as project managers; membership changes can only target users with an active membership in the same organization. Work items can carry an explicit `assignedUserId`, validated against active membership in that project, while legacy free-text assignees remain compatible.

Collaboration events are persisted in an outbox and delivered by an API worker with atomic leases, idempotent activity/notification upserts, bounded retries and exponential backoff. Notifications are now scoped to active project members; assignment notifications target the assignee. The activity feed requires active project membership for non-manager roles. The collaboration workspace includes project roster management.

The Phase 12 transactional path now couples event-producing domain writes and outbox inserts on supported MongoDB topologies. Standalone MongoDB remains a documented non-atomic fallback. Failed-event replay, HTTP/JWT authorization tests and transaction coverage are described below; real-time Socket.IO remains intentionally deferred. MongoDB-backed query-scope/notification-ownership integration tests run in CI. Socket.IO remains intentionally deferred until authenticated handshake, room authorization and revocation behavior can be tested end-to-end. Existing project module APIs remain organization-scoped for backward compatibility; project-level enforcement is currently applied to membership validation, assignment, notifications and activity feed access. See [Project membership and outbox API](docs/api/project-membership-and-outbox.md).


## Phase 11 — Workflow-wide collaboration event coverage and worker fencing

Collaboration event coverage now includes safety-event status transitions and document version additions in addition to task assignments, commercial changes, inspections, NCR/CAPA, safety reports, RFIs, submittals, document registration and approval decisions. Notification summaries remain concise and do not include document bodies, reviewer comments, incident narratives or uploaded content.

The outbox worker now uses a unique lease fencing token on every claim. Delivery and retry state changes must match the current token, preventing a delayed worker whose lease was taken over from marking a newer worker's event delivered or resetting its retry state. MongoDB integration tests cover notification ownership, tenant/project filters and stale-worker fencing. Unit tests cover allowlisted events and the fencing filter.

Phase 12 supersedes the prior enqueue limitation for event-producing workflows on transaction-capable MongoDB. The API detects transaction support at startup. `OUTBOX_TRANSACTION_MODE=required` fails startup on standalone MongoDB; `auto` (default) explicitly logs and reports the non-atomic fallback, and `disabled` opts out. For production, configure a replica set or sharded cluster and set `required`. See [Project membership and outbox API](docs/api/project-membership-and-outbox.md).


## Phase 12 — Transactional outbox, HTTP authorization and audit reliability

Implemented: event-producing commercial, task-assignment, quality, safety, RFI, submittal and document mutations now use a shared mutation-plus-outbox helper. When MongoDB reports replica-set or mongos topology, the domain writes and outbox event are committed in one transaction with snapshot read concern and majority write concern. The helper uses Mongoose's connection transaction wrapper to reset document state safely across transaction retries.

Runtime topology is checked after MongoDB connects. Configure `OUTBOX_TRANSACTION_MODE=required` for production; startup fails if transactions are unavailable. `auto` (default) explicitly warns and reports `non_atomic_fallback` on standalone MongoDB, where a domain write may persist even if the subsequent outbox insert fails. `disabled` explicitly opts out. The readiness endpoint reports the active outbox transaction mode. CI uses MongoDB 7 as a single-node replica set and sets transaction mode to required.

Added owner/admin/project-manager failed-event inspection and replay endpoints, with organization/project filters and replay actor/time/count metadata. Activity writes are append-only through application-level Mongoose APIs; idempotent creation is keyed by source event. This is not a tamper-evident ledger against direct database administrators.

Verification covers transaction rollback/commit, expired worker lease recovery, idempotent delivery retry, notification ownership, HTTP/JWT cross-tenant denial, active/inactive project membership, role restrictions, member addition, task assignment, safety and commercial event creation, and failed-event replay authorization. CI does not yet constitute a full browser end-to-end suite. Socket.IO, cryptographic audit chaining/external immutable storage, broader workflow HTTP coverage, and an operator-facing UI for failed events remain follow-up work.
