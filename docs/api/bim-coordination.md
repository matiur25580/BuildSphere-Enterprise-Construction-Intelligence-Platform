# BIM model coordination and CDE integration

BuildSphere BIM coordination connects a controlled IFC file revision in the project document register to structured coordination models and model-element issues.

## Routes

All endpoints are under `/api/v1/projects/:projectId/bim` and require a bearer access token plus active project membership.

| Method | Route | Permission |
|---|---|---|
| GET | `/models` | Active project member |
| POST | `/models` | Project manager or organization owner/admin |
| GET | `/issues` | Active project member |
| POST | `/issues` | Project manager or organization owner/admin |
| PATCH | `/issues/:issueId/status` | Project manager or organization owner/admin |

List issues accepts optional `status`, `priority`, and `modelId` filters.

## IFC model registration

1. Create a controlled document in the Delivery workspace.
2. Upload a `.ifc` file as a document version. The current secure upload path requires a replica-set/sharded MongoDB transaction topology and a reachable ClamAV scanner.
3. Register the document through `POST /models` with `documentId`, `modelName`, `discipline`, `revision`, `ifcSchema`, and optional description.
4. The API verifies that the document belongs to the authenticated tenant and project, the current version points to a private scanned asset, the asset MIME type is IFC, and the checksum is present.
5. The model record pins the document, asset, version and SHA-256 checksum. Revisions are immutable snapshots; upload a new controlled document version and register a new model record to coordinate against the new version.

IFC files are accepted as `application/ifc`, must begin with the ISO 10303-21 exchange-file marker, and share the secure document adapter's 25 MiB size limit. Extension, MIME and content signature are checked; ClamAV scans the bytes before private storage. This bounded upload supports small coordination extracts, not large federated authoring models.

## Coordination issues

Create an issue with:
- Project-scoped model ID and issue reference.
- Title, detailed description, issue type and priority.
- Optional IFC compressed GlobalId (22 characters).
- Optional level/zone, due date and active project-member assignee.
- Optional structured viewpoint containing camera position/direction/up vectors, field of view, selected IFC GlobalIds and hidden IFC GlobalIds.

The issue stores the exact model revision it was created against. This prevents an issue from silently appearing to reference a newer model version after a subsequent upload.

Issue states follow explicit transitions:

```text
open -> in_progress -> resolved -> closed
                         |          |
                         v          v
                       reopened <-+
```

A reopened issue can move back to in_progress. Every transition appends an actor-attributed history entry and emits an allowlisted project activity event through the collaboration outbox.

## Security and governance

- Tenant and project scope are derived from authenticated request context.
- Every read requires active project membership.
- Writes require project manager role or organization owner/admin role plus active project membership.
- A model can only reference a scanned IFC asset from a controlled document in the same project.
- Assignees must be active members of the same project.
- IFC files use the private document storage, malware scanning, SHA-256 verification and authenticated download controls.
- Model and issue mutations use the collaboration transaction/outbox path where MongoDB transactions are enabled.

## Interoperability and current boundaries

The data model is **BCF-inspired**: issues carry a model revision, IFC GlobalId references, viewpoint camera vectors, selected/hidden component IDs and a status/comment history. It is not yet a complete buildingSMART BCF 2.1/3.0 import/export implementation. No BCF ZIP archive parser or exporter is included.

This milestone does not include a browser 3D geometry viewer, IFC geometry/property-set parsing, automatic clash detection, model federation engine, DWG authoring, Revit/Navisworks/ACC connectors, drawing overlays, coordinate transformation tooling, or large-file multipart uploads. IFC schema is recorded as declared metadata and is not inferred by parsing the file. The UI provides model registers and issue coordination, not model rendering.

For production use with large models, add a streaming object-storage adapter, background IFC validation/metadata extraction, BCF exchange packages, model federation and a WebGL viewer as separate scalable services.
