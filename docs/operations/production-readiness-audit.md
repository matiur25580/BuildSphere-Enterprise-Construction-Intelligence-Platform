# Production Readiness Audit

**Audit date:** 2026-11-23  
**Audited branch:** `main`  
**Audited commit:** `632a8e10007fa8f980ad33046bc68ae56e33887d`  
**Method:** repository and GitHub configuration review. No production credentials, cloud account, live database, running deployment, or external scanner was available to this audit.

## Executive summary

BuildSphere has a substantial application-security and reliability foundation: organization-scoped authorization, rotating refresh sessions, project-role middleware, private document storage, malware scanning, checksummed downloads, transaction-aware collaboration outbox processing, readiness endpoints, and an automated build/integration-test/Docker pipeline.

The repository is **not yet evidenced as production-ready**. The strongest blockers are reproducible dependency installation, live infrastructure validation, and broader security/operations assurance. A ClamAV readiness protocol defect was also found and is being corrected with a regression test in the accompanying change.

Do not interpret a successful CI run as proof of production deployment, cloud durability, security certification, or compliance.

## Confirmed strengths

- Access JWTs have a 15-minute lifetime; refresh sessions use opaque random tokens, store token hashes, rotate transactionally, and revoke a token family on detected reuse.
- Authenticated requests re-check active users, memberships, roles, and active organization state.
- Project access is scoped to the authenticated organization and active project membership; organization owners/admins retain organization-wide access within their tenant.
- Helmet, explicit CORS allowlisting, request IDs, bounded JSON bodies, and API rate limiting are configured.
- Document uploads validate extension, MIME type and file signatures; malware scanning fails closed; storage keys are opaque; downloads verify size/checksum and are audited.
- Production storage configuration fails closed unless S3 is explicitly selected. S3 readiness has a bounded timeout and the adapter applies S3-managed AES256 encryption.
- Collaboration outbox transactions can be required at startup; worker leases, fencing tokens, idempotency and bounded retries are implemented.
- CI builds API and web workspaces, runs API unit/MongoDB integration tests, and builds the production API image.

## Findings and remediation

### P1 — ClamAV readiness PING used an invalid terminator

**Evidence:** `apps/api/src/modules/delivery/document-storage.ts` sent the PING command with a literal backslash-zero sequence instead of a NUL byte. The INSTREAM upload-scanning command already uses the correct NUL terminator. The readiness function could therefore report ClamAV unavailable even while the daemon was healthy.

**Remediation in this change:** send the actual NUL-terminated `zPING\0` protocol command and add a TCP-level regression test that verifies the exact bytes and PONG response. Merge only after the fresh CI pipeline passes.

### P1 — Dependency installation is not reproducible

**Evidence:** the audited Git tree contains no npm lockfile. CI and the Docker build use `npm install`, including the production image stage. Semver ranges can therefore resolve different transitive dependency versions between builds.

**Remediation:** generate and commit a root npm lockfile, switch CI and both Docker stages to `npm ci` (with the appropriate production omit-dev flag in the runtime stage), and review automated dependency updates. This requires a real npm lockfile generated and validated by npm; it is not fabricated in this audit.

### P1 — Production infrastructure is not verified

**Evidence:** repository configuration documents required production settings, but source review cannot verify actual MongoDB replica-set health, S3 bucket policy/IAM permissions, encryption and lifecycle settings, ClamAV signature freshness, secret-manager configuration, DNS/TLS, backups, or a live deployment.

**Remediation:** deploy to a staging environment first; run startup/readiness checks, upload/download/malware tests, S3 migration verification, restore drills, and a rollback exercise. Promote only after evidence is captured. Never place credentials in Git.

### P2 — Readiness routes are not actually exempted from the API rate limiter

**Evidence:** the limiter is mounted at `/api`, so Express exposes the path inside its `skip` callback without that mount prefix (for example `/v1/ready`). The current skip list compares `/ready` and `/health`. Frequent platform probes can therefore consume the normal API rate limit.

**Remediation:** compare the mounted paths (`/v1/health` and `/v1/ready`) or move the health routes outside the limiter; add a regression test.

### P2 — CI permissions and supply-chain controls need strengthening

**Evidence:** the workflow does not declare an explicit least-privilege `permissions` block, uses major-version action tags, and does not run dependency vulnerability, secret, or static-analysis scans.

**Remediation:** explicitly restrict the workflow token to `contents: read`; pin third-party actions to reviewed commit SHAs; add Dependabot/Renovate and CodeQL/dependency review or equivalent scanning with documented triage.

### P2 — Frontend and quality gates are incomplete

**Evidence:** the web workspace exposes a build script but no test or lint script. The CI workflow builds the web workspace but its test command runs only the API suite. The root lint script is a no-op where workspaces have no lint script.

**Remediation:** add frontend unit/component tests, browser-level critical-path tests, ESLint/format/type gates, and ensure the CI workflow actually invokes them.

### P2 — Runtime container and shutdown hardening

**Evidence:** Docker base images use floating `node:22-alpine` tags; no container healthcheck is defined. The server closes the HTTP listener and disconnects MongoDB on signals, but has no explicit shutdown deadline or bounded drain strategy for in-flight requests/outbox work.

**Remediation:** pin base images (prefer digests), add a healthcheck that uses a lightweight liveness endpoint, set resource limits at the deployment layer, and implement a bounded graceful-shutdown deadline with worker drain and forced exit.

### P2 — Readiness performs live dependency probes on every request

**Evidence:** each readiness call probes MongoDB state, ClamAV TCP PING, and document storage (including S3 HeadBucket). S3 calls are timeout-bounded but not cached.

**Remediation:** measure probe frequency and latency in staging; use a short bounded cache or separate startup/deep dependency checks if probe volume causes load, while retaining fail-closed behavior for actual uploads.

### P2 — Operational resilience and legal posture need evidence

**Evidence:** the repository describes backup and recovery recommendations but does not provide evidence of scheduled backups, restore tests, disaster-recovery objectives, external audit retention, monitoring/alert routing, or a declared repository license.

**Remediation:** document RPO/RTO, backup ownership, restore cadence, incident runbooks, metrics/traces/alerts, and an external tamper-evident audit archive. Add an appropriate license only after the owner chooses the intended legal terms.

## Ordered next steps to reach the 9.5+ target

1. Merge the ClamAV PING fix only after CI passes.
2. Add the npm lockfile and switch all installs to `npm ci`.
3. Correct and test health/readiness rate-limit exemptions.
4. Add explicit CI permissions, action SHA pinning, dependency and static security scanning.
5. Add frontend, end-to-end, load and security regression coverage.
6. Deploy to staging with real MongoDB, S3 and ClamAV; validate migration and rollback.
7. Prove backups/restores, monitoring, alerting, incident response and bounded shutdown.
8. Complete an independent penetration test and close all high/critical findings.

## Audit limitations

This is a static repository/configuration audit, not a penetration test or live infrastructure assessment. GitHub's branch-protection endpoint was not accessible to the audit integration, so required-review and branch-protection settings remain unverified. Secret-scanning and code-scanning alert inventories were also not available through the inspected API surface. No claim is made that these controls are disabled; they require owner-side verification.
