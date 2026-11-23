# BuildSphere

**Enterprise Construction Intelligence & Project Delivery Platform**

BuildSphere is an AI-assisted construction operations platform designed to connect project planning, commercial control, field execution, quality, safety, and delivery intelligence in one workspace.

> Project status: active development. The foundation and first authentication milestone are implemented; broader project workflows are being delivered incrementally.

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
2. Copy `.env.example` to `apps/api/.env`.
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

Never commit real credentials or `.env` files.

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

## Authentication milestone scope

Implemented: registration, login, password hashing, JWT access tokens, rotating refresh sessions, logout, authenticated profile, organization creation, owner membership, role middleware, and authentication rate limiting.

Not yet implemented: email verification, password reset delivery, MFA, organization switching, and membership administration. Do not treat this milestone as production-ready security without the testing and controls described in the security documentation.

See [Architecture Overview](docs/architecture/overview.md).
