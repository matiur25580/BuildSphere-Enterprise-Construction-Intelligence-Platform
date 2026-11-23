# Secure document management API

All routes are under `/api/v1/projects/:projectId/delivery`. Bearer authentication is required. The API derives organization scope from the current authenticated membership, verifies the project belongs to that organization, and scopes document and asset queries by organization, project and document. Binary download additionally requires active project membership. Upload requires an active project-manager membership, or an organization owner/admin who is an active member of the project.

## Document register and approvals

- `GET /documents` — list up to 100 project document records.
- `POST /documents` — create document metadata. Supply `documentNo`, `title`, and `category`. A legacy HTTPS `fileUrl` and `fileName` pair may still be supplied together; otherwise the document starts at version 0 until a binary file is uploaded.
- `POST /documents/:documentId/versions` — register an existing HTTPS file reference as the next version.
- `PATCH /documents/:documentId/approval` — submit, approve, reject or request revision using the existing approval transition rules.
- `POST /documents/:documentId/files` — upload a binary file as the next controlled version.
- `POST /documents/:documentId/uploads` — create a 24-hour resumable upload session (JSON: `fileName`, `contentType`, `totalBytes`, optional whole-file `sha256`).
- `GET /documents/:documentId/uploads/:uploadId` — retrieve session state and the checksums/part numbers already received, so clients can resume safely.
- `PUT /documents/:documentId/uploads/:uploadId/parts/:partNumber` — upload one raw `application/octet-stream` chunk with `X-Part-Sha256`; chunks are 5 MiB except the final chunk.
- `POST /documents/:documentId/uploads/:uploadId/complete` — verify chunk checksums and total size, assemble, malware-scan, and atomically register the document version.
- `DELETE /documents/:documentId/uploads/:uploadId` — abort a session and remove its stored chunks.
- `GET /documents/:documentId/files/:assetId/download` — download a stored file after server-side authorization.

## Binary upload contract

Send the raw file bytes (not JSON or multipart) with:
- `Content-Type`: exact matching MIME type.
- `X-File-Name`: URI-encoded original filename.
- Request body: file bytes.

Allowed types are PDF, PNG, JPEG, WEBP and IFC. The API enforces a 25 MiB maximum, validates the extension/MIME pairing and file signature, strips path components/control characters from filenames, and assigns an opaque random storage key. IFC uploads must use `.ifc` plus `application/ifc` and begin with the ISO 10303-21 exchange-file marker. DOC/DOCX, ZIP, DWG, RVT and arbitrary binaries are not accepted by this adapter.

The API streams the content to ClamAV using its INSTREAM protocol before persisting it. Malware-positive files are rejected with `422`; missing/unavailable scanner configuration fails closed with `503`. A scanner response other than clean is never treated as clean. The application stores files outside the public web root using the configured private storage adapter. The filesystem driver uses restrictive directory/file permissions; the S3 driver uses path-style bucket addressing and authenticated AWS Signature Version 4 requests; it never creates public object URLs. Downloads use attachment disposition, `nosniff`, and private no-store caching. SHA-256 and byte size are recorded and re-verified before download.

## Resumable upload behavior\n\nResumable sessions are bound to the authenticated user, organization, project and document. Each part is limited to 5 MiB, carries a SHA-256 digest, and can be retried idempotently only when the bytes match the already accepted part. The API exposes received-part metadata so clients can continue after a network interruption. Completion requires every sequential part, verifies each stored part and optional whole-file SHA-256, then applies the same file signature checks, ClamAV scan, transaction, asset metadata and audit path as a regular upload. Concurrent completion is guarded by a persisted session state transition. Sessions expire after 24 hours; clients should abort abandoned sessions. The API lifecycle worker also reclaims expired sessions and stale completion attempts, including chunk objects and any uncommitted final object recorded before storage persistence.\n\n## Atomicity and audit

Uploads require verified MongoDB transaction support. The asset metadata, new document version, append-only application-level access event, and collaboration outbox event are committed in the same transaction. The binary is first written to a private temporary-by-identity storage key; it is removed if the metadata transaction fails. A failed cleanup leaves its session in a retryable cleanup state; the lifecycle worker retries it. A final object is recorded on the session before writing so a process crash cannot lose the cleanup reference. Committed asset keys are checked before deletion.

The document access log records upload and authorized download events with organization, project, document, asset, actor, checksum, filename, request ID and timestamp. These records are immutable through the application model/API, but are not cryptographically tamper-evident against privileged direct database or volume access.

## Runtime prerequisites

Configure:
- `OUTBOX_TRANSACTION_MODE=required` and a replica-set or sharded MongoDB deployment.
- Set `DOCUMENT_STORAGE_DRIVER=filesystem` and `DOCUMENT_STORAGE_DIR` as a private, durable, access-restricted mounted volume; or set `DOCUMENT_STORAGE_DRIVER=s3` and configure `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` (optionally `S3_SESSION_TOKEN`).
- For S3, use a private bucket with public access blocked and grant the API identity only the required bucket/object permissions (ListBucket for readiness, GetObject, PutObject and DeleteObject). Prefer workload/temporary credentials where available; never commit credentials. HTTPS is required for S3 in production.
- `CLAMD_HOST` and optional `CLAMD_PORT` (default 3310) for a reachable ClamAV daemon.
- Network policy allowing the API to reach the scanner privately; do not expose ClamAV to the public internet.
- Encrypted storage, backups, retention/legal-hold policy, monitoring and disaster-recovery procedures appropriate to the deployment.

Uploads intentionally fail closed if the scanner or transaction topology is unavailable. The default adapter is a private POSIX filesystem volume. For multi-replica deployments, configure the S3-compatible adapter so every API replica reads and writes the same private bucket. No public static route or unauthenticated object URL exposes stored files.

## Verification and boundaries

MongoDB-backed HTTP tests exercise raw PDF upload, resumable session creation, part checksum rejection, idempotent part retry, successful completion, clean scan, malware-positive rejection, MIME/signature rejection, checksum-backed download, recipient authorization, inactive project membership and cross-tenant denial. A local fake ClamAV protocol server is used in CI; production scanner efficacy still depends on a correctly maintained ClamAV deployment and signature updates.

Not included in this milestone: native S3 multipart-upload sessions, automated retention/legal-hold enforcement, or a full inventory sweep for untracked objects created outside the upload-session lifecycle. The resumable API stores bounded chunks as private objects and assembles a maximum 25 MiB final object through the storage adapter. Also not included: IFC geometry/property parsing or 3D preview, DWG/RVT, BCF ZIP import/export, drawing markup, OCR, document classification, retention automation, legal holds, electronic signatures, watermarking, DLP, federated identity, and a tamper-evident external audit ledger. See [BIM coordination](bim-coordination.md) for the IFC model register and BCF-inspired issue workflow. Existing HTTPS file references remain supported for migration/compatibility and do not receive the same server-side binary controls.
\n\n## Upload lifecycle cleanup\n\nThe API runs a bounded cleanup worker every five minutes. It claims expired `uploading` sessions, `completing` sessions stale for at least one hour, and previously claimed cleanup sessions whose retry window has elapsed. A claimed session is moved to `cleaning` before object deletion so concurrent API replicas do not process it simultaneously. The worker deletes referenced chunk objects and deletes a pending final object only when no `DocumentAsset` references it. The session is removed only after cleanup succeeds; failures retain the session and are retried after 15 minutes. This is session-led reconciliation, not a bucket-wide inventory scan: manually-created objects or objects whose session metadata was externally deleted require separate storage inventory controls.\n