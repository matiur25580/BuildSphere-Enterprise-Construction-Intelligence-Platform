# AI project intelligence and evidence API

All endpoints are mounted under `/api/v1/projects/:projectId/intelligence` and require a bearer access token plus an active organization membership.

## GET `/insights`

Builds an on-demand, tenant-scoped intelligence snapshot from the latest project records. The response includes a generation timestamp, methodology disclosure, key metrics, prioritized risk signals, confidence labels, and evidence references.

Signals cover:
- **Schedule:** overdue and blocked tasks plus gap between elapsed project time and average recorded task progress.
- **Commercial:** submitted/approved/paid purchase-order commitments relative to the project budget; overdue invoices in the project's currency.
- **Quality:** open NCR severity, failed inspections, and overdue CAPA actions.
- **Safety:** open critical/high/other safety event counts.
- **Information flow:** overdue submitted RFIs and submittals awaiting review/resubmission.
- **Currency integrity:** active commercial records in currencies other than the project's reporting currency are excluded from commitment ratio and surfaced separately.

Risk scores are deterministic rules-based indicators, not calibrated probabilities or machine-learning forecasts. Confidence reflects the number of linked records, not statistical confidence. Thresholds are initial heuristics and should be reviewed against actual project outcomes before operational reliance.

## POST `/ask`

Body: `{ "question": "Which tasks are overdue?" }` (3–500 characters).

Performs keyword retrieval over the same current project evidence set and returns matching records, matched terms, and their source metadata. It does not call an external LLM or generate unsupported project facts. If no records match, it explicitly says so.

## Tenant and data boundaries

- Organization scope comes only from the authenticated membership in `request.auth`; the caller cannot supply an organization ID.
- The project must belong to the active organization before evidence is queried.
- Each source collection query includes both organization and project identifiers.
- The snapshot uses bounded reads (maximum 500 work/commercial/cost-code/CAPA records, 200 delivery records per register, and 100 daily reports) and is computed on demand, not persisted.
- This milestone does not provide predictive model training, schedule critical-path calculation, cash-flow forecasting, live integrations, vector search, LLM-based summarization, or a conversational agent. It does not replace project controls, safety leadership, or commercial review.

## Validation

`npm test --workspace=@buildsphere/api` builds the API and runs isolated Node test-runner unit tests for risk scoring and evidence ranking. Database-backed authorization and tenant-isolation integration tests remain a separate hardening requirement.
