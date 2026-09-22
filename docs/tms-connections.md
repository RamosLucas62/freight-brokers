# Customer TMS document connections

## Scope and release status

Settings → Connect your TMS accepts vendor-issued credentials and enables a
server-side document importer for **Tai, hosted McLeod and Rose Rocket**. Imported
PDFs enter the existing validation, classification, invoice/POD/rate-confirmation,
audit, billing and report pipeline without the customer forwarding an email.

This is an implementation against published API contracts, **not live vendor
certification**. No developer accounts, private documentation or test credentials
were available. Production deployment and live acceptance remain outstanding.
Turvo, Aljex, AscendTMS and MercuryGate are visibly unavailable. There is no
“request configuration” action that could be mistaken for an integration.

## How customers connect

| Provider | Customer supplies in secure Settings | Automatically imported scope |
| --- | --- | --- |
| Tai | Site code and API key with Broker and Accounting read access | Carrier Bill, POD and Carrier Confirmation documents on shipments returned by approved accounting bills, across all five sync states. Other accounting integrations' sync flags are never changed. |
| McLeod PowerBroker / LoadMaster | Hosted API hostname, Company ID, bearer token, and document type IDs for carrier invoices/POD/rate confirmations | Images on delivered orders, filtered by the customer's document type mapping and returned as PDFs. Only `*.loadtracking.com` and `*.mcleodhosted.com` customer hosts are supported. Custom/on-premise hosts are unavailable. |
| Rose Rocket | Integration service-account Request Details JSON, or organization/user/client ID and client secret | Uploaded PDF documents on orders announced by order-status webhooks. Connecting automatically registers the official webhook; previously observed orders are revisited for late attachments. Existing orders need a status event before discovery. There is no historical backfill or bill/manifest attachment discovery. |

An account may need vendor API licensing/permissions before it can connect.
Credential setup is not a consent-only OAuth flow. Missing permissions fail setup
or produce a visible synchronization error; they cannot be provisioned by this app.
Existing verified Tai accounts remain paused until the owner selects **Enable
automatic import**. Existing Rose accounts reconnect to register the new webhook.
Credential verification starts collection but leaves email available. A completed
TMS audit containing at least one invoice with high-confidence matched signed POD,
delivery date and rate confirmation/authorized total validates the initial intake.
Only then is email document intake disabled for the whole company. Credential
changes reset this validation. This is an initial delivery check, not certification
of all vendor data or future loads. Every TMS batch independently requires evidence
for every new invoice before any invoice/report commit. Missing or ambiguous
documents are listed on the job as evidence needed. Receipts and terms for additional
charges beyond fuel are not modeled; these batches require manual review and are
not represented as complete. Late documents create a new batch on the next scan.
Unchanged incomplete batches remain in review, avoiding repeated automatic work.
During initial validation identical PDF content remains protected by existing
tenant/hash audit and invoice-usage uniqueness checks. Outgoing report emails remain enabled. Customers must disconnect every
active TMS connection to use email for documents outside the supported scope.
Temporary sync errors do not reopen email. New emails are recorded as blocked;
already queued emails are checked before downloading and before auditing. Work
already committed is retained. The first-login guide offers TMS selection and
routes unsupported/no-TMS customers to the private email address and sender setup. Only PDFs are processed; other formats fail validation.

## Provider research (2026-09-22)

This is a brokerage-oriented shortlist, not a measured market-share ranking.

- **Tai:** [API keys](https://docs.taicloud.net/docs/obtaining-an-api-key),
  [approved bills](https://docs.taicloud.net/reference/publicapibill_getbills),
  [shipment documents](https://docs.taicloud.net/reference/publicapibroker_getdocuments-1).
  Read-only `GET /PublicApi/Accounting/v2/Bills?syncStatus=...` and
  `GET /PublicApi/Broker/v2/Documents?shipmentId=...`, authenticated with `x-api-key`.
  Download links must remain on the customer's HTTPS Tai host and receive no API key.
- **McLeod:** official hosted [order search](https://tms-dsly.loadtracking.com/ws/docs/services?operation=getOrdersByAdvancedSearch&role=-1&service=OrderService)
  and [imaging](https://tms-dsly.loadtracking.com/ws/docs/services?operation=getImageList&role=-1&service=ImagingService).
  `GET /ws/orders/search`, `/ws/images/O/{orderId}`, `/ws/images/{imageId}`;
  bearer token plus `X-com.mcleodsoftware.CompanyID`. Response company IDs are checked.
- **Rose Rocket:** [service-account authentication](https://roserocket.readme.io/docs/rose-rocket-api-oauth-20-authentication-guide),
  [webhook registration](https://roserocket.readme.io/docs/webhooks-2),
  [uploaded documents](https://roserocket.readme.io/docs/documents).
  Registers an Order Status Changed subscription through platformModel objects.
  Uploaded file IDs resolve through `/api/v2/platformModel/file/url`; signed storage
  downloads receive no bearer token. Duplicate webhook deliveries are deduplicated.
  Reconnecting may create another vendor destination; duplicate deliveries are safe,
  but vendor-side destination cleanup is not implemented.
- **Turvo:** [Connect](https://turvo.com/connect/) and [API license](https://turvo.com/turvo-api-license-agreement/)
  establish integration availability. The document-export authentication, payloads,
  pagination and download contract could not be validated from accessible public docs.
- **Aljex:** [integrations](https://www.aljex.com/integrations/) and
  [API Export/DataSync plans](https://www.aljex.com/pricing/) do not provide a usable
  public carrier-document export contract.
- **AscendTMS:** [EDI setup](https://ascendtms.kayako.com/article/100-edi-description-and-the-edi-setup-process)
  describes provisioning, not a validated outbound PDF API.
- **MercuryGate:** [public API documentation](https://qa-api-docs.mercurygate.net/documentation/)
  covers DigitalFreight operations; this is insufficient to implement customer TMS
  carrier-invoice document export. The relevant remote-service contract is needed.

For each unavailable provider, development still requires its actual document
export contract and an authorized test tenant. Credentials alone do not establish
unknown endpoints, document semantics, pagination or webhook authentication.

## Deployment and operation

1. Apply migrations through `041_tms_evidence_validation.sql` using the normal
   migration process. The isolated database test does not modify production.
2. Configure `ROSE_ROCKET_CREDENTIAL_KEY` and `TMS_CREDENTIAL_KEY` as separate,
   stable 32-byte base64url encryption keys in the deployment secret store. Keep
   backups; rotating keys without re-encryption makes existing credentials unreadable.
3. Set `WORKER_ENABLED=true` on the running service. New connections are unavailable
   when it is disabled. Rose setup also respects `ROSE_ROCKET_CONNECT_ENABLED=false`.
4. Set the public HTTPS `PORTAL_URL` for webhook delivery. Rose requires outbound
   API access and inbound `/webhooks/rose-sync/...`; redact token-bearing paths at
   the reverse proxy as well as in application logs. S3 and Google storage downloads
   are allowed; additional official storage hosts require exact operator-controlled
   `ROSE_ROCKET_DOCUMENT_HOSTS` entries.
5. Deploy backend and frontend together. Connect authorized accounts and verify
   actual invoice/POD arrival, duplicate handling and disconnect before rollout.

The worker claims one connection at a time and schedules another scan five minutes
after completion. Persistent leases recover after 15 minutes. Jobs retain tenant,
provider, record, document/revision and connection-version identifiers. Stable batch
IDs prevent unchanged documents from being requeued after credential rotation.
Tai document IDs and Rose file IDs are treated as immutable; replacing content
without changing these IDs is not detected. Changed document bundles can produce
new jobs; invoice duplicate controls remain in the existing audit pipeline.

Limits are explicit errors, not silent truncation: 8 MB JSON, 20 MB per PDF, existing
40 MB aggregate intake, 100 documents per record, 100 new intake jobs per tenant/day,
10,000 McLeod orders or Rose observed orders, 10,000 bills per Tai status and a
10-minute scan budget. Oversized accounts need incremental discovery before rollout.
A single malformed record stops that scan and surfaces an error. The portal shows
last successful discovery, errors and batches queued; queued does not mean audited.

## Security and validation

- Owner/billing-admin membership, tenant activity, CSRF, configured MFA and rate
  limits protect connection mutations. Provider URLs and redirects are restricted.
- AES-256-GCM protects credentials server-side; multi-provider encryption binds
  tenant and provider. No catalog/admin response contains credentials.
- Service-only database functions enforce tenant/connection-version/lease ownership,
  deduplication and quotas. Disconnect clears secrets, invalidates leases and blocks
  pending document downloads. Completed account erasure also clears credentials.
- Rose activation/disconnect update both importer and webhook gates transactionally.
  Scoped webhook tokens authenticate delivery; payloads are refetched through the
  tenant's credentials rather than trusting document bytes or URLs in webhooks.
- TMS jobs explicitly bypass email authentication only after connection authorization;
  they retain file scanning, classification and all downstream audit controls.

Run `npm run typecheck`, `npm test`, `npm run build` and
`node scripts/check-db-isolated.cjs`. Tests use simulated provider responses and a
disposable PostgreSQL instance. They cover discovery/download contracts, unsafe
URLs, credentials, tenant isolation, role gates, worker leases, deduplication,
disconnect, failures and the shared audit pipeline. They do not prove live vendor
compatibility. No production secrets or database state were changed for this PR.


## Live acceptance still required

No supplier test tenant was available during development. Before production release,
use authorized accounts for each supported product/version to exercise: a complete
invoice/POD/rate package; a missing POD; a missing or mismatched rate confirmation;
unsigned/illegible POD; late attachments; invoice replacement; supplementary fees;
duplicate PDFs across email and TMS; credential rotation; and disconnect. Inspect
actual downloaded PDFs and load references against the supplier UI. Verify the
initial-collection state and email transition, and confirm incomplete batches remain
in review. This cannot be replaced with simulated endpoint tests. Rose bill/manifest
attachments, historical discovery and unsupported provider APIs remain outstanding.
