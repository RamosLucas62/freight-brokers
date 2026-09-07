# Security policy

Do not open public issues containing customer data, invoice samples, credentials, webhook payloads, or infrastructure details. Report suspected vulnerabilities privately to the repository security contact configured in GitHub Security Advisories.

## Supported version

Only the production branch is supported. High and critical dependency alerts block releases.

## Incident response

1. Contain: disable the affected route or credential and preserve immutable logs.
2. Assess: identify tenants, documents, recipients, and provider actions involved.
3. Eradicate: rotate affected secrets, revoke sessions, patch, and verify tenant isolation.
4. Recover: restore service gradually, reconcile Stripe/Resend queues, and validate reports.
5. Notify: follow contractual and legal notification requirements without including sensitive data in tickets.
6. Learn: document timeline, root cause, detection gap, owner, and due date for each action.

Never paste production secrets or invoice contents into incident chat or public scanners.
