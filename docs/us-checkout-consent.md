# U.S. checkout consent setup

The application now requires affirmative clickwrap consent before it returns a Stripe Payment Link. It stores the exact disclosure, document versions, server timestamp, plan, cadence, email, IP address, user agent, and checkout source. A random acceptance ID is passed to Stripe as `client_reference_id` and linked back when `checkout.session.completed` arrives.

## Stripe dashboard (required for all nine Payment Links)

1. Open **More → Product catalog → Payment links**.
2. Open each Core, Growth, and Scale link for Monthly, 6 months, and Annual.
3. Select **Edit**, then **Advanced options**.
4. Enable **Require customers to accept your terms of service**.
5. In **Settings → Public details**, set the Terms of Service URL to `https://api.audit.aiolympian.com/terms` and the Privacy Policy URL to `https://api.audit.aiolympian.com/privacy`.
6. Confirm the 7-day trial, post-trial amount, recurring cadence, and cancellation messaging on each link.

The app-level checkbox is the evidence-bearing acceptance. Stripe's checkbox provides a second clear confirmation on the hosted payment page.

## Public pricing integration

The JSON sent to `POST /checkout` must include:

```json
{
  "email": "buyer@example.com",
  "plan": "core",
  "period": "monthly",
  "terms_accepted": true,
  "turnstile_token": "..."
}
```

The checkbox must start unchecked, be required, and link directly to `/terms` and `/privacy`. Do not combine product-marketing consent with this contractual consent.

## Release checklist

- Apply migration `027_checkout_legal_acceptance.sql` before deploying the application.
- Verify a completed test checkout creates one row in `audit_checkout_acceptances` and later fills `checkout_completed_at` and `stripe_checkout_session_id`.
- Confirm the Stripe webhook includes `client_reference_id`.
- Have U.S. counsel insert the company's exact legal entity, principal address, governing state, and dispute forum before production launch.
- Review privacy disclosures and vendor contracts whenever a processor or retention period changes.
