# U.S. portal consent setup

Olympian collects contractual clickwrap consent after the customer's first authenticated portal login and before the product guide or any customer data is available. Checkout remains focused on plan selection and payment.

## Customer experience

1. The customer completes Stripe Checkout and configures the workspace.
2. The secure access email signs the customer into the portal.
3. A blocking dialog links directly to the current Terms of Service and Privacy Policy.
4. Both unchecked confirmations are required.
5. After acceptance is stored, the product onboarding guide opens.

The dialog cannot be dismissed with Escape, and customer APIs remain blocked until the current terms and privacy versions have been accepted. Administrators are exempt from the customer onboarding dialog.

## Evidence recorded

Migration `031_portal_legal_acceptance.sql` stores an immutable record containing the authenticated user, exact acceptance wording, Terms version, Privacy version, server timestamp, IP address, and user agent. A new document version causes the dialog to appear again.

## Stripe dashboard

Do not enable Stripe's optional Terms of Service checkbox if the intended product flow is portal-only consent. Stripe must still clearly display trial length, price, billing cadence, automatic renewal, and cancellation information for each Payment Link.

## Release checklist

- Apply migration `031_portal_legal_acceptance.sql` before deploying the application.
- Complete a test checkout and first login.
- Confirm no legal checkbox appears on the sales or private-audit checkout page.
- Confirm the portal dialog appears before the product guide and cannot be dismissed.
- Confirm one row is created in `audit_portal_legal_acceptances` with the current versions and server timestamp.
- Sign in again and confirm the dialog no longer appears for the accepted versions.
- Have U.S. counsel review the final Terms, Privacy Policy, legal entity, governing state, dispute forum, trial, renewal, cancellation, and privacy disclosures before production launch.
