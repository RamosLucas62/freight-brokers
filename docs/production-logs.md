# Production logs

The server writes one JSON object per line to stdout/stderr. EasyPanel captures these streams, and the production deployment can forward them to Better Stack through the configuration in [better-stack.md](better-stack.md). Every error has a unique `error_id`, including queue failures that happen before a job can be claimed. Search that value from the Google Chat alert to find the exact error record. Use `request_id`, `audit_request_id`, `job_id`, `tenant_id`, `event_id`, or `delivery_id` to follow the wider operation across its lifecycle.

Important failure events:

- `free_audit.submission.failed` and `free_audit.worker.failed`
- `resend.webhook.failed` and `inbound.worker.failed`
- `stripe.webhook.enqueue_failed` and `stripe.event.failed`
- `notification.delivery.failed`
- `billing.overage.failed`, `tenant.deletion.failed`, and `free_audit.retention.failed`
- `health.readiness.failed`, `process.unhandled_rejection`, and `process.uncaught_exception`

`stage` identifies the failed operation, such as `download_r2`, `scan_pdf`, `audit_pipeline`, `send_result`, `sender_authorization`, or `store_attachment`. `error_code` is safe to share internally and `upstream_status` contains an HTTP status when it is available.

Queue failures also include a sanitized `provider_reason` (`SUPABASE_TIMEOUT`, `SUPABASE_NETWORK_ERROR`, or `SUPABASE_QUERY_ERROR`) and, when supplied by Supabase, a `provider_code` such as a PostgREST code. Raw database messages are intentionally not logged.

Every HTTP response includes `X-Request-Id`. When a customer reports an error, record that value and search for the matching `request_id` in EasyPanel logs.

The logger recursively redacts fields whose names resemble authorization headers, cookies, tokens, passwords, signatures, API keys, payloads, documents, or contents. Do not add PDF bodies, raw webhook payloads, bank data, email addresses, or credentials to log fields.

Recommended retention is 30 days for normal logs and 90 days for security/error logs, subject to the organization's privacy policy. Restrict log access to operators and do not expose the EasyPanel log viewer publicly.
