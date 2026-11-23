# Document object storage

Document file bytes are stored behind a provider interface. The local provider is intended for development and single-instance tests. Production startup fails closed unless `DOCUMENT_STORAGE_PROVIDER=s3` is explicitly configured; this avoids silently writing private project files to ephemeral instance disks.

## S3-compatible configuration

Configure the API runtime with:

- `DOCUMENT_STORAGE_PROVIDER=s3`
- `DOCUMENT_S3_BUCKET` — a private bucket dedicated to BuildSphere documents
- `DOCUMENT_S3_REGION` (or the standard `AWS_REGION`)
- `DOCUMENT_S3_ENDPOINT` — optional for S3-compatible services such as MinIO
- `DOCUMENT_S3_FORCE_PATH_STYLE=true` — set for providers that require path-style addressing
- `DOCUMENT_S3_ACCESS_KEY_ID` and `DOCUMENT_S3_SECRET_ACCESS_KEY` — optional when the runtime supplies an IAM/workload identity; if one is supplied, both must be supplied

The API uses the AWS credential provider chain when explicit credentials are omitted. Uploaded objects are encrypted at rest with S3-managed AES256 encryption. Use a bucket policy that denies public access and permits only the API's runtime identity to read, write and delete objects. Do not expose bucket credentials to browser clients.

## Existing local files

If an existing deployment has document assets on local disk, copy every object named by `DocumentAsset.storageKey` from `DOCUMENT_STORAGE_DIR` to the configured bucket using the exact same object key before switching the API to the S3 provider. Verify byte size and SHA-256 against each `DocumentAsset` record before cutover. Keep a protected backup of the original directory until downloads have been verified on all application instances. Do not point multiple production instances at independent local disks.

## Development and tests

Without `NODE_ENV=production`, the provider defaults to local storage for backwards-compatible development. Tests should set `DOCUMENT_STORAGE_PROVIDER=local` and use a temporary `DOCUMENT_STORAGE_DIR`. Production does not have this fallback.

The API continues to malware-scan uploads before storing them, records immutable storage keys and checksums in MongoDB, verifies the checksum on download, and audits authorized downloads. The S3 bucket is an external operational dependency and should be monitored and backed up independently of MongoDB.
