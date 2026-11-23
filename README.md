# BuildSphere

**Enterprise Construction Intelligence & Project Delivery Platform**

BuildSphere is an AI-assisted construction operations platform designed to connect project planning, commercial control, field execution, quality, safety, and delivery intelligence in one workspace.

> Project status: foundation in progress. This repository is the engineering starting point; production workflows are being delivered incrementally.

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
- **Client data:** Redux Toolkit and TanStack Query.
- **Validation:** Zod.
- **Quality:** TypeScript strict mode; automated tests will be added with domain workflows.

## Repository structure

```text
apps/
  api/          Express API
  web/          React web application
packages/
  shared/       Shared contracts and constants
docs/
  architecture/
infrastructure/
```

## Getting started

### Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- MongoDB 7 or newer (local or hosted)

### Setup

1. Clone the repository.
2. Copy `.env.example` to `apps/api/.env` and set your local values.
3. Install workspace dependencies:

   ```bash
   npm install
   ```

4. Start the API and web application:

   ```bash
   npm run dev
   ```

5. Open the web app at http://localhost:5173.
6. Check API health at http://localhost:5000/api/v1/health.

Never commit real credentials or `.env` files.

## Engineering principles

- Secure by default; validate input at API boundaries.
- Enforce organization isolation on the server for every tenant-owned resource.
- Keep business rules in domain services, not controllers.
- Make important mutations auditable.
- Test authorization boundaries as well as happy paths.
- Prefer observable, documented workflows over placeholder feature breadth.

## Roadmap

1. Foundation and developer experience.
2. Authentication, organizations, memberships, and RBAC.
3. Project portfolio and schedule management.
4. Commercial management and procurement.
5. Contractor and field operations.
6. Quality, safety, documents, and approvals.
7. AI project intelligence and evidence-backed insights.
8. Security hardening, automated testing, and deployment.

See [Architecture Overview](docs/architecture/overview.md).
