# Production Readiness Audit

**Audit date:** 2026-11-24  
**Audited branch:** `main`  
**Audited commit:** `a97151476cf2b74e944e519ddc2d4a9e9af2c548`  
**Method:** static repository/configuration review plus review of merged pull-request scope and GitHub Actions metadata. No production credentials, cloud account, live database, running deployment, or external scanner was available.

## Executive summary

BuildSphere now has a materially stronger application-security and CI foundation than the original 2026-11-23 audit snapshot. The repository history records remediation for the ClamAV readiness protocol, reproducible npm installs, health/readiness rate-limit exemptions, least-privilege and pinned CI actions, dependency/static analysis, frontend quality gates, browser E2E coverage, container health/shutdown behavior, and authentication/project-membership tenant-boundary regression tests.

**This repository is not yet evidenced as production-ready.** The largest remaining gaps are live infrastructure verification, deployment and rollback evidence, backup/restore and disaster-recovery proof, operational monitoring, independent security testing, and a few repository-level hardening decisions listed below.

The post-merge CI and CodeQL workflows for audited commit `a97151476cf2b74e944e519ddc2d4a9e9af2c548` were still in progress when this audit update was prepared. Earlier PR validation is not a substitute for those exact post-merge runs. Recheck both workflows before treating this commit's checks as complete.

Do not interpret a successful CI run as proof of production deployment, cloud durability, security certification, or compliance.

## Confirmed application and repository controls

- Access JWTs have a 15-minute lifetime; refresh sessions use opaque random tokens, store token hashes, rotate transactionally, and revoke a token family on detected reuse.
- Authenticated requests re-check active users, memberships, roles, and active organization state.
- Project access is scoped to the authenticated organization and active project membership; organization owners/admins retain organization-wide access within their tenant.
- Helmet, explicit CORS allowlisting, request IDs, bounded JSON bodies, and API rate limiting are configured.
- Document uploads validate extension, MIME type and file signatures; malware scanning fails closed; storage keys are opaque; downloads verify size/checksum and are audited.
- Production storage configuration fails closed unless S3 is explicitly selected. S3 readiness has a bounded timeout and the adapter applies S3-managed AES256 encryption.
- Collaboration outbox transactions can be required at startup; worker leases, fencing tokens, idempotency and bounded retries are implemented.

## Remediations recorded as merged

The following repository-level audit items have corresponding merged changes. This records code/configuration progress, not independent proof of operational effectiveness.

| Area | Recorded remediation |
|---|---|
| ClamAV protocol | PING now uses the NUL-terminated protocol command, with a regression test. |
| Dependency reproducibility | Root npm lockfile committed; CI and Docker install paths use `npm ci`. |
| Health/readiness | Mounted health/readiness paths are exempted from the normal API rate-limit behavior and covered by tests. |
| CI supply chain | Workflow permissions are restricted; third-party actions are SHA-pinned; Dependabot, dependency audit and CodeQL controls are present. |
| Frontend quality | Frontend unit tests and lint/quality gates are included in CI. |
| Browser critical paths | Playwright coverage exercises authentication/session restoration and project lifecycle flows. |
| Container lifecycle | Docker healthcheck and bounded graceful-shutdown behavior were added. |
| Authentication boundaries | MongoDB-backed tests cover refresh-session ownership and logout revocation. |
| Project tenant boundaries | MongoDB-backed tests cover project-member enumeration and cross-project/cross-organization membership update isolation. |

Relevant merged work includes PRs #16–19, #26, and #34–38. Confirm the current workflow files and code before relying on any control in a deployment.

## Remaining findings and next actions

### P1 — Live infrastructure and deployment are unverified

**Evidence gap:** source review cannot verify actual MongoDB replica-set health, S3 bucket policy/IAM permissions, encryption and lifecycle settings, ClamAV signature freshness, secret-manager configuration, DNS/TLS, deployed image identity, or runtime behavior.

**Next action:** use a staging environment with production-equivalent configuration. Capture evidence for startup/readiness, tenant isolation, upload/download/malware rejection, S3 permissions and migration, TLS, secrets, rollback, and deployment health. Never place credentials in Git or audit artifacts.

### P1 — Backup, restore and disaster recovery are unproven

**Evidence gap:** no executed backup/restore drill or approved RPO/RTO evidence was available to this review.

**Next action:** document data owners, backup frequency/retention/encryption, RPO/RTO, restore procedure, and run a timed restore drill. Record outcome and remediation, not just configuration screenshots.

### P1 — Independent security assurance is outstanding

**Evidence gap:** CI tests and CodeQL do not replace a penetration test, threat-led review, or external validation of authorization and file-handling controls.

**Next action:** commission an independent application/API assessment, prioritize tenant isolation, authentication/session lifecycle, uploads/downloads, and collaboration/outbox workflows, then track all high/critical findings to verified closure.

### P2 — Floating container base-image tags

**Evidence:** the prior source review identified floating `node:22-alpine` base-image tags. This remains a hardening item unless the current Dockerfiles have since been changed.

**Next action:** inspect the current Dockerfiles and pin supported base images to immutable digests, with a documented update cadence and automated rebuild process.

### P2 — Readiness probe load characteristics

**Evidence:** readiness checks can probe MongoDB, ClamAV, and document storage/S3. A timeout bounds an individual S3 request but does not establish acceptable aggregate probe load.

**Next action:** measure readiness frequency and latency in staging. Add a short bounded cache or separate startup/deep dependency checks only if measurements justify it; preserve fail-closed upload behavior.

### P2 — Monitoring, alerting and audit retention

**Evidence gap:** no live metrics/traces, actionable alert routes, incident exercise, or external tamper-evident audit archive was available.

**Next action:** define service-level indicators, alert thresholds/ownership, incident runbooks, retention and access controls for audit events; test alert delivery and incident response.

### P2 — Branch protection, secret scanning and license decisions

**Evidence gap:** branch-protection/ruleset enforcement and secret-scanning alert inventory could not be verified through the available review. No legal license decision was supplied.

**Next action:** owner-side verify required checks/reviews and secret-scanning configuration. Choose and approve a repository license before adding one; do not infer legal intent.

## Ordered roadmap

1. Recheck post-merge CI and CodeQL for audited SHA `a97151476cf2b74e944e519ddc2d4a9e9af2c548`.
2. Inspect and, if still floating, digest-pin Docker base images.
3. Verify branch protection/rulesets and secret scanning in GitHub settings.
4. Complete staging validation with real MongoDB, S3 and ClamAV, including rollback.
5. Execute and document backup/restore and disaster-recovery drills.
6. Add operational monitoring, alerting, incident runbooks and tamper-evident audit retention.
7. Complete an independent penetration test and close all high/critical findings.
8. Make the repository license decision with the owner's explicit approval.

## Audit limitations

This is a static repository/configuration audit and merged-change review, not a penetration test or live infrastructure assessment. No production credentials, cloud account, live database, running deployment, external scanner, or backup system was available. GitHub branch-protection and secret-scanning settings remain unverified. Workflow runs for the audited main SHA were in progress at the time of this update. No claim is made that unverified controls are disabled, nor that BuildSphere is certified, compliant, or production-ready.
