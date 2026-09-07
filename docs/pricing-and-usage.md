# Pricing and usage billing

The product has two USD plans. Scale is the recommended default.

| Plan | Included each month | Monthly | 6 months prepaid | Annual prepaid | Additional invoice |
| --- | ---: | ---: | ---: | ---: | ---: |
| Core | 500 | US$497 | US$2,682 | US$4,970 | US$0.75 |
| Scale (Recommended) | 1,500 | US$997 | US$5,382 | US$9,970 | US$0.50 |

The included allowance resets each calendar month in the customer's configured time zone, including prepaid contracts. Overage is closed after month-end and charged automatically as a separate Stripe invoice against the saved payment method. The six base prices remain the only catalog prices; an idempotent invoice item carries the monthly overage.

## What counts

- One accepted PDF containing exactly one extracted invoice counts once.
- The same PDF hash for the same customer never counts twice, including a retry after an interrupted job.
- Files rejected before extraction do not count.
- A corrected document with different bytes and a different hash counts as a new invoice.
- A PDF containing zero or multiple invoices is rejected and does not count.
- Documents received while the account is suspended are blocked before download and extraction and do not count.

## Entitlements

Core includes one inbound address/flow, up to three portal users and report recipients, the current automatic risk checks, email reports, portal history and email support. Scale includes the higher allowance, multiple inbound flows, administrative history, exception reprocessing, priority email support and monthly risk summaries. Scale recipients and users are commercially unlimited; the service keeps a high technical abuse ceiling of 500 entries per category.

The product must not claim rate auditing, rate-confirmation matching, accessorial validation or automatic money recovery until those features are implemented.

## Stripe setup

Create six recurring prices and set their IDs in `STRIPE_PRICE_CORE_MONTHLY`, `STRIPE_PRICE_CORE_SEMIANNUAL`, `STRIPE_PRICE_CORE_ANNUAL`, `STRIPE_PRICE_SCALE_MONTHLY`, `STRIPE_PRICE_SCALE_SEMIANNUAL` and `STRIPE_PRICE_SCALE_ANNUAL`. Use interval counts 1 month, 6 months and 1 year respectively.

Keep the Customer Portal configuration limited to payment-method changes, invoice history and plan switching at the end of the paid period. Cancellation remains disabled there because it runs through the in-product retention flow. Checkout and subscription metadata must preserve `plan_code` and `billing_period`; webhooks synchronize those values locally.

Renewal is automatic. Cancellation stops the next renewal without a prorated refund. A failed payment starts a three-day grace period; after it expires, new audits are suspended. A later paid invoice reactivates the account. Final subscription cancellation starts the existing 30-day data-deletion window.

Apply migrations in numeric order through `010_pricing_and_usage_billing.sql` before deploying this version.
