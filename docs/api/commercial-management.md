# Commercial management API

All endpoints require a bearer access token. Project and organization scope is resolved from the authenticated membership; no client-supplied organization ID is accepted.

Base path: `/api/v1/projects/:projectId/commercial`

## Cost codes
- `GET /cost-codes` — list active and inactive project cost codes.
- `POST /cost-codes` — create a cost code (owner, admin, project_manager).

Fields: `code`, `name`, `budget`, optional `description`, `currency`. Cost-code references are unique within a project and organization.

## Commercial register
- `GET /records?type=purchase_order|invoice|payment_claim` — list records, optionally filtered by type.
- `POST /records` — create a purchase order, invoice, or payment claim (owner, admin, project_manager).
- `PATCH /records/:recordId/status` — advance a record through its workflow (owner, admin, project_manager).
- `GET /summary` — return project budget, cost-code allocation, PO commitment, invoice, claim, paid, pending, and remaining-after-PO totals.

Record fields: `type`, `reference`, `counterparty`, `amount`, `issueDate`, optional `dueDate`, `costCodeId`, `currency`, `description`, and `notes`. Cost codes must belong to the same project and organization.

## Status workflow
- Draft → Submitted or Cancelled
- Submitted → Approved, Rejected, or Cancelled
- Approved → Paid or Cancelled
- Rejected → Draft or Cancelled
- Paid and Cancelled are terminal.

## Accounting boundary
This milestone is an operational commercial register, not a general ledger or tax/accounting system. Amounts are stored as decimal JavaScript numbers; a production financial ledger should move to integer minor units or a decimal type, add immutable journal entries, tax rules, partial payments, retention, exchange-rate policy, and audit events before being used for statutory accounting.
