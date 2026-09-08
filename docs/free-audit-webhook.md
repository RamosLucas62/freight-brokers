# Free Audit webhook

The public page submits the existing form as `multipart/form-data` to:

`POST https://api.audit.aiolympian.com/webhooks/free-audit`

Required fields: `name`, `company`, `email`, `consent`, `turnstile_token`, and one or more `files`. Optional fields: `phone` and `loads_per_month`. The file input may use either `files` or `invoices` as its name. PDF and ZIP uploads are accepted, with up to 50 unique PDFs, 20 MiB per PDF, and 100 MiB total after ZIP extraction.

```js
const form = document.querySelector('#free-audit-form');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const response = await fetch('https://api.audit.aiolympian.com/webhooks/free-audit', {
    method: 'POST',
    body: data,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || result.error || 'Unable to submit the audit');
  // Always show the generic success message. It does not reveal whether the
  // address has already used its free audit.
  document.querySelector('#free-audit-message').textContent = result.message;
});
```

Do not manually set the `Content-Type` header: the browser adds the multipart boundary. Configure the Cloudflare Turnstile widget to write its response into a field named `turnstile_token` (or copy `turnstile.getResponse()` into that field before creating the `FormData`).

## Server configuration

Apply migration `011_free_audit_lead_flow.sql`, then configure:

```dotenv
FREE_AUDIT_ORIGIN=https://aiolympian.com
FREE_AUDIT_ORIGINS=https://aiolympian.com,https://www.aiolympian.com
FREE_AUDIT_PUBLIC_URL=https://api.audit.aiolympian.com
FREE_AUDIT_OFFER_URL=https://aiolympian.com/pricing
```

`FREE_AUDIT_ORIGIN` remains the required primary browser origin. Set optional `FREE_AUDIT_ORIGINS` to a comma-separated allowlist when the form is served from more than one exact origin. No wildcard origins are accepted. `FREE_AUDIT_PUBLIC_URL` creates email-verification links. `FREE_AUDIT_OFFER_URL` is used in the result email and in the email sent after a repeat request. Successful submissions intentionally return `202 Accepted`; browser `response.ok` treats that status as success.

## Security and lifecycle

- An IP and an email can submit at most three requests per 24 hours.
- A cryptographically random confirmation link expires after 30 minutes; invoice processing starts only after it is consumed.
- The database enforces one free audit per normalized email atomically.
- A repeat request does not store or process its uploaded files. A plans email is sent at most once per 24 hours to prevent mail abuse.
- ZIP paths are ignored, duplicate files are removed by SHA-256, and declared plus actual expanded sizes are checked to resist traversal and decompression bombs.
- Uploads stay inert in private R2 storage; every PDF is checked by the private malware scanner before it is opened or processed.
- Only invoices dated in the last 30 days are counted. An invoice with no readable invoice/load date remains in the report for manual review instead of being silently discarded.
- The report is sent with PDF and CSV attachments and a paid-plan call to action.
- If confirmed documents cannot be processed, the customer receives a safe, actionable failure email. Invalid, encrypted, unsafe and oversized documents get tailored guidance without exposing internal infrastructure details.
- A processing failure does not consume the free entitlement: the same address may replace the files, confirm again and complete its one successful free audit.
- Stored documents, the generated result, and lead profile are deleted after 30 days. Only a one-way email hash and usage counters remain so the free entitlement cannot reset.

The endpoint returns a generic `202` response for both first and repeat requests. This prevents the page from being used to discover whether an email address is already in the system.
