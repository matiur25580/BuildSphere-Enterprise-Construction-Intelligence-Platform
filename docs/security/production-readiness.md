# Production security and operations

## API controls

- Helmet security headers are enabled globally; Express' identifying header is disabled.
- Browser origins are restricted to the comma-separated `CLIENT_URL` allowlist. Requests without an Origin header remain valid for server-to-server clients.
- Set `TRUST_PROXY` only when the API is behind a known reverse proxy. Use a hop count where possible; do not enable it on a directly exposed service.
- Every response receives an `X-Request-Id` UUID. Include this identifier when reporting operational issues.
- The API applies a configurable-by-code global request budget (300 requests per 15 minutes per IP); authentication routes retain their stricter dedicated limiter.
- JSON request bodies are limited to 1 MB.
- `/health` is a liveness endpoint; `/ready` reports whether MongoDB is connected.

## Required environment

- `NODE_ENV=production`
- `MONGODB_URI`: private MongoDB connection string with least-privilege credentials and TLS.
- `JWT_ACCESS_SECRET`: unique secret of at least 32 characters, stored in the deployment secret manager.
- `CLIENT_URL`: comma-separated exact HTTPS origins.
- `OUTBOX_TRANSACTION_MODE=required`: transaction-capable replica set or sharded MongoDB topology.
- `DOCUMENT_STORAGE_DIR`: private persistent volume path (container default `/var/lib/buildsphere/documents`).
- `CLAMD_HOST` and optional `CLAMD_PORT=3310`: private ClamAV daemon endpoint; uploads fail closed if scanning is unavailable.
- `TRUST_PROXY`: false unless deployed behind a trusted proxy.

Never put production credentials in source control or Docker build arguments. Rotate credentials through the hosting provider's secret manager.

## Container

The root Dockerfile builds both workspaces and runs the compiled API as the non-root `node` user. It exposes port 5000. The runtime image provisions `/var/lib/buildsphere/documents` for private file storage; mount a durable volume there and back it up. Configure MongoDB, ClamAV connectivity and secrets at runtime; the image does not bundle a database or malware scanner.

## Deployment checklist

1. Provision MongoDB with network restrictions, backups, TLS and a dedicated application user.
2. Configure all environment variables in the platform secret manager.
3. Deploy the container and expose only HTTPS through a trusted ingress.
4. Configure `CLIENT_URL` to the exact frontend origin(s).
5. Configure `TRUST_PROXY` to match the ingress topology.
6. Verify `/api/v1/health` and `/api/v1/ready`.
7. Run a registration/login/refresh/logout smoke test and verify tenant boundaries before onboarding real users.

## Current limitations

This milestone adds security configuration tests and a deployable API container, not a production hosting account or live deployment. Automated MongoDB-backed tests now cover collaboration and secure document upload/download boundaries. External vulnerability scanning, secret rotation automation, metrics/tracing export, distributed object storage, storage reconciliation, backup-restore drills and a cryptographically tamper-evident audit ledger remain follow-up work. The current document storage adapter uses a private filesystem volume and is not a multi-region object store. Do not treat the current build-only and unit-test CI as proof of production readiness.
