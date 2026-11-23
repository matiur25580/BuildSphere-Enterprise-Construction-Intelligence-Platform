# Organization membership administration

All endpoints are under `/api/v1/organization` and require a valid bearer access token. The token's organization scope is enforced server-side; callers cannot supply or override `organizationId`.

| Method | Endpoint | Access | Purpose |
|---|---|---|---|
| GET | `/members` | Owner, admin | List memberships for the authenticated organization |
| POST | `/members` | Owner, admin | Add/reactivate an existing active BuildSphere account by email |
| PATCH | `/members/:memberId` | Owner, admin | Change an organization role or suspend/reactivate a membership |

## Add a member

```json
{ "email": "colleague@example.com", "role": "member" }
```

The account must already exist and be active. A duplicate active membership returns `409`; a suspended/invited membership can be reactivated. The API never creates an account from an email address and does not send an invitation.

## Roles and safeguards

- Owners can assign any organization role and manage any membership.
- Admins can add and manage project managers, members and viewers. They cannot create, modify, suspend or demote owners or administrators.
- Only owners can grant or revoke owner/admin privileges.
- The organization must retain at least one active owner. Attempts to demote or suspend the last active owner return `409`.
- Membership changes are scoped by both member ID and the authenticated organization. A member ID from another tenant is indistinguishable from a missing record and returns `404`.
- Membership changes update an organization-level revision document inside the same transaction. This serializes concurrent governance changes so two simultaneous owner changes cannot both pass a stale last-owner check.
- Authentication middleware rechecks active membership and role on each request. A suspended member or a token carrying a stale role is denied without waiting for access-token expiry.

## Transaction prerequisite

Membership administration requires MongoDB multi-document transactions and returns `503` when the runtime topology is not transaction-capable. Use a replica set or sharded cluster. In production, set `OUTBOX_TRANSACTION_MODE=required` so the API refuses to start on an unsupported topology. The collaboration readiness field reports the detected transaction capability.

## Verification

MongoDB-backed HTTP/JWT integration tests cover owner/admin/member access, add and duplicate handling, privilege escalation denial, cross-tenant member IDs, immediate session denial after suspension, owner handover and last-active-owner protection. The CI MongoDB service runs as a single-node replica set.

## Current boundaries

This release manages existing accounts only. Email invitations and delivery, account recovery, MFA, organization switching, bulk provisioning, SCIM, and a separate organization audit-event stream are not implemented. Project-level membership remains a separate role layer; organization role does not automatically grant project membership.
