# Financial decimal precision

BuildSphere stores project budgets, cost-code budgets and commercial-record amounts as MongoDB `Decimal128` values. API request validation preserves decimal inputs as strings, and commercial summaries use exact decimal-string arithmetic for derived balances.

## API contract

Send financial values as decimal strings (for example, `"125000.40"`). Numeric JSON inputs remain accepted for compatibility with existing clients, but new integrations should use strings so a client cannot round a value before it reaches the API. Values support up to 15 whole-number digits and 4 fractional digits.

Currency codes are normalized to uppercase ISO-style three-letter codes. A project budget is denominated in the project's currency. Cost codes and commercial records retain their own currency. Summary totals are never added across currencies: the legacy top-level summary figures represent the project's currency, and `currencyBreakdown` reports totals separately for every currency represented in active cost codes or non-rejected/non-cancelled commercial records. No foreign-exchange conversion is implied.

## Existing database migration

The schema change requires a one-time data migration for existing numeric BSON values. Back up the database and run this from `apps/api` with the same `MONGODB_URI` used by the API:

```sh
npm run migrate:financial-decimals
```

The migration converts `projects.budget`, `costcodes.budget` and `commercialrecords.amount` to BSON Decimal128. It is safe to re-run. It fails if a value cannot be converted; investigate that record rather than bypassing the failure. Run it before deploying code that expects Decimal128 aggregation results.

## Operational note

This change improves arithmetic precision; it does not turn the commercial register into a statutory accounting ledger. Tax rules, currency-specific minor-unit enforcement, immutable journals, exchange-rate sourcing and reconciliation remain separate work.
