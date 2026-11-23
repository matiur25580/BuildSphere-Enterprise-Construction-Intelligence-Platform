# Production validation and recovery runbook

This runbook defines the evidence required before a BuildSphere deployment can be approved for production. Execute it in an isolated staging environment first. It is a procedure, not evidence that any check has already passed.

## 1. Safety and prerequisites

- Name an application owner, database/storage owner, incident contact, and change approver.
- Use a staging environment with production-equivalent MongoDB topology, S3-compatible object storage, ClamAV, TLS, identity, and network policies.
- Use synthetic test data and dedicated staging credentials. Never paste credentials, tokens, signed URLs, customer documents, or raw personal data into tickets or this repository.
- Confirm the tested application image digest, source commit, schema migration plan, rollback image, and maintenance window.
- Confirm backups exist and that restore permissions are available before running destructive or migration tests.
- Do not run migration, malware, load, restore, or failure-injection tests against production without a separately approved change plan.

## 2. Deployment and configuration evidence

Record the environment, UTC timestamp, source commit, container image digest, operator, and result for each check.

| Check | Procedure | Pass criteria |
|---|---|---|
| Runtime identity | Inspect the deployed image and runtime user | Expected immutable image digest; process runs as non-root |
| Secrets | Verify secret-manager references and rotation ownership | No secrets in Git, image layers, logs, or client bundles |
| TLS and ingress | Verify certificate chain, hostname, HTTPS redirect, and allowed origins | Valid TLS; only approved origins and ingress paths |
| MongoDB | Verify replica-set topology, authentication, TLS, least-privilege DB user, and readiness | Expected members healthy; app can perform required operations only |
| S3 storage | Verify private bucket, encryption, lifecycle/retention, IAM scope, and API-only access | Public access blocked; runtime identity has only required object operations |
| ClamAV | Verify daemon reachability and signature freshness; test harmless EICAR fixture only in isolated staging | Clean upload accepted; EICAR fixture rejected; scanner outage fails closed |
| Health | Exercise `/api/v1/health` and `/api/v1/ready` during healthy and dependency-unavailable states | Health reports process liveness; readiness becomes non-200 when required dependencies are unavailable |
| Migrations | Apply migrations to a staging clone and inspect results | No unexpected data loss; migration is repeatable or has a documented recovery path |

For S3, use `DOCUMENT_STORAGE_PROVIDER=s3`, a private bucket, and the runtime workload identity where supported. If explicit access keys are used, both key ID and secret must be supplied. Never expose bucket credentials to browser clients. The readiness probe uses `HeadBucket`, so the API identity needs the documented bucket-level permission in addition to object operations. See [document object storage](document-object-storage.md).

If migrating existing local document files, keep local storage active for the dry run, run `npm run migrate:document-files-to-s3` from `apps/api`, inspect the size/SHA-256 verification output, then use `-- --apply` only after approval. Verify downloads from every API instance and retain a protected copy of the source directory until acceptance.

## 3. Tenant and application acceptance tests

Use at least two organizations and multiple users with distinct roles.

- Verify users cannot enumerate, read, mutate, or download another tenant's projects, members, documents, or collaboration events.
- Verify inactive memberships and revoked sessions lose access immediately.
- Verify refresh-token rotation, replay rejection, logout revocation, and organization switching.
- Verify project membership changes are constrained to the correct project and organization.
- Verify document upload rejects unsupported extensions, MIME/signature mismatches, oversized files, and malware test fixtures.
- Verify authorized downloads preserve checksum validation and audit records.
- Verify collaboration/outbox events are not duplicated under retry and worker restart.

Capture request IDs, sanitized outcomes, and test case identifiers; never retain bearer tokens or document contents in evidence.

## 4. Backup and restore / disaster recovery drill

Before the drill, approve a target recovery point objective (RPO) and recovery time objective (RTO), define data owners, and identify the authoritative backup system for both MongoDB and document objects.

1. Confirm backup schedule, retention, encryption, access restrictions, and alerting.
2. Select a recent backup and record its creation time and integrity/availability result.
3. Restore MongoDB and document objects into an isolated recovery environment. Never overwrite staging or production data.
4. Restore the database and object storage to a mutually consistent recovery point; validate document storage keys, sizes, and SHA-256 checksums.
5. Start the application against the isolated restore and run authentication, tenant-isolation, project-read, document-download, and collaboration smoke tests.
6. Measure achieved data-loss window and elapsed recovery time against approved RPO/RTO.
7. Record failures, owners, due dates, and repeat the drill after remediation.

A backup configuration or green dashboard is not a successful restore drill. Do not claim recoverability until an isolated restore has been exercised.

## 5. Monitoring and incident readiness

Before production approval, define service-level indicators and named alert owners for:

- API availability, error rate, latency, and readiness failures.
- MongoDB availability, replication lag, connection saturation, and storage capacity.
- S3 request failures, latency, denied access, and unexpected public-access changes.
- ClamAV availability, scan failures, and signature age.
- Authentication abuse, rate-limit events, authorization denials, and suspicious document access.
- Outbox queue age, retry/dead-letter growth, and worker lease failures.
- Backup completion, backup age, restore-test status, and retention-policy drift.

Route alerts to a monitored channel with an on-call owner. Test alert delivery, escalation, and acknowledgement. Retain audit events in access-controlled, tamper-evident storage with a documented retention period. Run an incident tabletop covering credential compromise, tenant-isolation report, malware-scanner outage, storage outage, and failed deployment.

## 6. Deployment, rollback, and change control

- Deploy the exact image digest that passed CI and staging; do not deploy a mutable tag.
- Take and verify pre-change backups and record the current image digest and schema version.
- Use a canary or staged rollout where supported. Watch health, readiness, errors, latency, and dependency signals.
- Define rollback triggers and the person authorized to invoke rollback before deployment.
- Roll back to the last known-good image if acceptance thresholds fail. Treat database migrations separately: do not assume application rollback reverses schema/data changes.
- Verify readiness, critical user journeys, tenant boundaries, document upload/download, and background workers after rollback.
- Record deployment start/end, image digests, migration identifiers, approver, observations, and final decision.

## 7. Independent security assessment

Commission an independent, authorized assessment of authentication/session lifecycle, tenant isolation, role boundaries, document upload/download and malware handling, collaboration/outbox processing, API abuse controls, and deployment configuration.

Track each finding with severity, affected component, reproducible evidence, owner, due date, remediation commit, and retest result. Production approval requires no unresolved critical/high findings unless a formally documented risk exception is approved by the accountable owner.

## 8. Go / no-go decision

Production approval requires all of the following:

- [ ] Exact image digest and source commit recorded; CI and CodeQL checks pass.
- [ ] Staging deployment and rollback successfully exercised.
- [ ] MongoDB, S3, ClamAV, TLS, and secrets configuration verified.
- [ ] Tenant-boundary and critical application acceptance tests pass.
- [ ] Backup restore drill meets approved RPO/RTO.
- [ ] Monitoring, alert routing, audit retention, and incident escalation tested.
- [ ] Independent security assessment completed and critical/high findings closed or formally excepted.
- [ ] Named technical and business owners approve the evidence package.

If any required item is missing, record **NO-GO** and keep the deployment in staging. This repository's CI results alone do not establish production readiness.
