# Production security and operations

This document describes implemented application controls and the operational requirements that must be verified in each deployment. Repository code and CI do not, by themselves, establish production readiness.

## API controls

- Helmet security headers are enabled globally; Express' identifying header is disabled.
- Browser origins are restricted to the comma-separated `CLIENT_URL` allowlist. Requests without an Origin header remain valid for server-to-server clients.
- Set `TRUST_PROXY` only when the API is behind a known reverse proxy. Use a hop count where possible; do not enable it on a directly exposed service.
- Every response receives an `X-Request-Id` UUID. Include this identifier when reporting operational issues.
- The API applies a global request budget (300 requests per 15 minutes per IP); authentication routes retain their stricter dedicated limiter.
- JSON and URL-encoded request bodies are limited to 1 MB.
- `/api/v1/health` is a process liveness endpoint. It does not prove that dependencies can serve traffic.
- `/api/v1/ready` returns HTTP 200 only when MongoDB is connected, configured document storage is reachable, collaboration outbox transactions are enabled, and ClamAV responds to its PING health check. It returns HTTP 503 when any required dependency is unavailable. The response exposes dependency availability states, not provider credentials or error details.

## Required production environment

- `NODE_ENV=production`
- `MONGODB_URI`: private MongoDB connection string with least-privilege credentials and TLS. Use a transaction-capable replica set or sharded topology.
- `OUTBOX_TRANSACTION_MODE=required`: require transaction support for collaboration outbox writes; do not rely on a non-atomic fallback in production.
- `JWT_ACCESS_SECRET`: unique secret of at least 32 characters, stored in the deployment secret manager.
- `CLIENT_URL`: comma-separated exact HTTPS origins.
- `DOCUMENT_STORAGE_PROVIDER=s3`: production startup fails closed unless an explicit supported provider is configured. Use a private S3-compatible bucket dedicated to BuildSphere documents.
- `DOCUMENT_S3_BUCKET` and `DOCUMENT_S3_REGION` (or `AWS_REGION`); optionally configure `DOCUMENT_S3_ENDPOINT` and `DOCUMENT_S3_FORCE_PATH_STYLE=true` for compatible providers.
- Prefer the runtime workload/IAM identity. If explicit `DOCUMENT_S3_ACCESS_KEY_ID` credentials are used, `DOCUMENT_S3_SECRET_ACCESS_KEY` must also be set. Never expose either value to browser clients.
- `CLAMD_HOST` and optional `CLAMD_PORT=3310`: private ClamAV daemon endpoint. Uploads fail closed when scanning is not configured or unavailable.
- `TRUST_PROXY`: false unless deployed behind a trusted proxy.

The S3 bucket must block public access and enforce an appropriate encryption, retention, lifecycle, and backup policy. The API uses S3-managed AES256 encryption for uploaded objects. Scope the runtime identity to the required bucket/object operations; the readiness `HeadBucket` probe also requires the documented bucket-level permission. See [document object storage](../operations/document-object-storage.md) for setup and local-file migration guidance.

Never put production credentials in source control, Docker build arguments, frontend variables, or logs. Rotate credentials through the hosting provider's secret manager.

## Container and runtime

The root Dockerfile builds both workspaces and runs the compiled API as the non-root `node` user. It exposes port 5000. The runtime image provisions a local document directory for development/compatibility, but production must explicitly configure S3 storage; do not treat a container filesystem or independent per-instance local disks as durable shared document storage. Configure MongoDB, S3, ClamAV connectivity, and secrets at runtime. The image does not bundle a database or malware scanner.

## Deployment checklist

1. Provision MongoDB with a transaction-capable replica set or sharded topology, network restrictions, TLS, least-privilege credentials, and independently verified backups.
2. Provision a private S3 bucket and runtime identity; verify public access is blocked, encryption and retention are configured, and the API can perform required operations.
3. Configure ClamAV privately and verify signature freshness and scanner outage behavior.
4. Configure all environment variables in the platform secret manager; set `OUTBOX_TRANSACTION_MODE=required`.
5. Deploy the exact immutable container image digest that passed CI and staging validation. Expose only HTTPS through a trusted ingress.
6. Configure `CLIENT_URL` to the exact frontend origin(s) and `TRUST_PROXY` to match the ingress topology.
7. Verify `/api/v1/health` and `/api/v1/ready`. Exercise readiness failure when MongoDB, S3, ClamAV, or transaction support is unavailable.
8. Run registration/login/refresh/logout smoke tests, tenant-boundary tests, document upload/download and malware rejection tests, and collaboration/outbox checks using synthetic staging data.
9. Exercise rollback and a consistent MongoDB plus object-storage restore in an isolated recovery environment before production approval.

The detailed staging acceptance, backup/restore, monitoring, incident, and rollback procedure is in [the production validation and recovery runbook](../operations/production-validation-and-recovery-runbook.md).

## Current limitations and production gate

This milestone adds application security controls and a deployable API container, not a production hosting account or live deployment. The following remain deployment-specific evidence requirements:

- Staging validation with real MongoDB, private S3-compatible storage, and ClamAV.
- Verified MongoDB and object-storage backup/restore drills with documented RPO/RTO.
- Monitoring, alert routing, runbooks, and tamper-evident audit retention.
- Independent penetration testing and remediation of critical/high findings.
- Secret scanning, branch/ruleset governance, secret rotation ownership, and a documented license decision.
- Review of authentication limitations, including the absence of built-in MFA, email verification, and password-reset workflows.

Do not treat build/unit-test CI, a successful health endpoint, a configured backup, or this checklist as proof of production readiness. If required staging, recovery, security, or ownership evidence is missing, the deployment decision is **NO-GO**.
