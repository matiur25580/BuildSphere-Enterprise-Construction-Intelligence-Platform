# BuildSphere Architecture Overview

## Architectural approach

BuildSphere starts as a modular monolith: one deployable API organized around explicit business domains. This keeps local development and early delivery straightforward while preserving module boundaries for future extraction when scale and team ownership justify it.

## Workspace layout

- `apps/web`: React + TypeScript browser application.
- `apps/api`: Node.js + Express + TypeScript API.
- `packages/shared`: framework-neutral contracts and shared constants.
- `docs`: architecture, database, API, and security decisions.
- `infrastructure`: local and deployment infrastructure.

## Initial domain boundaries

Authentication, organizations, memberships, projects, schedules, commercial management, contractors, site operations, quality, safety, documents, approvals, notifications, analytics, AI intelligence, and audit logs.

## Multi-tenancy principles

1. Every tenant-owned record will carry an `organizationId`.
2. Tenant scope must be derived from the authenticated membership, never trusted from an arbitrary client-supplied ID.
3. Authorization is enforced in the API service layer and database query filters.
4. Cross-tenant access receives explicit negative tests.
5. Sensitive mutations produce immutable audit events.

## Initial request flow

Browser application → versioned Express API → authentication and tenant middleware → domain module service → MongoDB.

Background jobs, object storage, Redis, and realtime events will be introduced when their corresponding product workflows are implemented.
