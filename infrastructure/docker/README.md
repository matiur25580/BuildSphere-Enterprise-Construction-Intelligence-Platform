# Local Infrastructure

Docker Compose services will be added here as the API, MongoDB, Redis, and object-storage workflows are implemented. Keep secrets in local environment files; never commit credentials.


## Secure document storage (Phase 14)

The API image runs as the non-root `node` user and creates `/var/lib/buildsphere/documents` with runtime ownership. In production, mount a durable encrypted volume at this path and set `DOCUMENT_STORAGE_DIR` if using a different mount. Do not place this directory under the web static root or expose it through a reverse proxy.

Binary upload requires:
- MongoDB replica-set or sharded-cluster transactions (`OUTBOX_TRANSACTION_MODE=required`).
- A private ClamAV daemon reachable through `CLAMD_HOST` and `CLAMD_PORT` (default 3310).
- Updated AV signatures, restricted scanner network access, volume backups and monitored disk capacity.

The application fails closed if malware scanning is unavailable. The current filesystem adapter is intended for a single API node or a securely shared POSIX volume; it is not a distributed object store. Plan a managed S3-compatible storage adapter before horizontally scaling API replicas across independent hosts.
