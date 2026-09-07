# Production security runbook

## Required before deployment

- Put the origin behind Cloudflare and block direct public access. Enable Authenticated Origin Pulls or allow only current Cloudflare origin ranges.
- Create Turnstile keys and set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`.
- Run a private Redis instance with TLS and authentication. It must not have a public port.
- Run the PDF scanner on the internal network only. Use a random `PDF_SCAN_TOKEN` and never expose port 8080 publicly.
- Set random values of at least 32 bytes for `RATE_LIMIT_KEY_SECRET`, `PDF_SCAN_TOKEN`, and `METRICS_TOKEN`.
- Enable Supabase SSL enforcement, network restrictions, MFA for organization administrators, PITR/backups, Security Advisor alerts, and custom SMTP.
- Configure Supabase exposed schemas to `api` only after moving/publicly exposing the required RLS views or RPCs. Until then, keep `public` exposed with the migration's RLS and revoked grants.
- Configure Stripe to send only required subscription/invoice events. Rotate the webhook secret with an overlap period.
- Allow Resend and Stripe webhook traffic at the edge, but always keep signature verification enabled.
- Keep the R2 bucket private; deny public listing/access and use lifecycle deletion consistent with the retention policy.

## Container policy

Run the application with a read-only root filesystem, a writable memory-backed `/tmp`, all Linux capabilities dropped, `no-new-privileges`, 512 MB memory, one CPU, and a PID limit. Run web, notification worker, billing worker, and PDF scanner as separate services when scaling.

## Alerts

Scrape `/internal/metrics` with the bearer token from the private network. Alert on invalid webhook signatures, webhook failures, sustained 401/403/429 responses at the edge, queue age, failed notifications, OpenRouter spend, Resend quota/bounce/spam rates, deletion failures, and Stripe/local subscription divergence.

## Backups and recovery

Test a restore at least quarterly. The drill must verify tenant RLS, report recipient status, Stripe event deduplication, R2 object recovery, and deletion queue behavior. Record recovery time and recovery point results.

## Release gate

Require review for database migrations and billing/security code. Protect the default branch, require the Security checks workflow, enable secret scanning with push protection, and run a staging DAST scan before major releases. Commission an independent penetration test before onboarding larger customers.
