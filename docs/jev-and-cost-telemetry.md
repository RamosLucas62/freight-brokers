# Jev decisions and cost attribution

Apply migration `037_cost_telemetry.sql` before enabling Jev. Configure `JEV_ENABLED=true`, pin `JEV_MODEL=typesafe/jev-1.13`, and keep the decision and support thresholds at or above the values in `.env.example`. `JEV_BATCH_SIZE` bounds each audit decision request (default 8, maximum 20) so large audit jobs cannot create an unbounded Jev context.

Jev is called through OpenRouter's alpha Decisions API. It never receives a PDF. The existing extraction and verification layers first convert documents into bounded structured evidence; Jev then answers English typed questions about semantic consistency and risk. A high-confidence concern adds `JEV_SEMANTIC_REVIEW` to the real exception queue. It cannot remove deterministic exceptions. In portal support, a high-confidence human-routing decision can immediately offer escalation.

Every metered OpenRouter call requests or reads provider usage and records its model, operation, tokens, and USD cost in `audit_cost_events`. Paid work is attributed to `tenant_id`; free-audit work is attributed to its lead/request ID without creating a fake tenant. The table is deliberately provider-neutral so storage, email, OCR, and other costs can use the same ledger when their actual or contracted unit costs are available.

Administrators can read the current-month summary at `GET /api/portal/admin/costs`. Optional `company`, `from`, and `to` query parameters provide customer and date filtering. The admin portal exposes the same summary as **Custos por cliente**, including pending cost events where a provider returned usage without a cost.

Operational checks before activation:

1. Deploy migration 037.
2. Run one free audit and one test-tenant inbound audit.
3. Confirm invoice extraction, document classification, POD, rate confirmation, Jev, and support events appear with the expected subject and tenant.
4. Compare summed OpenRouter cost with the OpenRouter activity page for the same time window.
5. Keep the feature disabled if the Decisions API response contract changes; it is alpha and this integration fails closed instead of silently bypassing the decision layer.
