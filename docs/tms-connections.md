# Customer TMS connection setup

## Delivered behavior

Settings → Connect your TMS contains a provider selector and in-portal actions.
Rose Rocket accepts service-account credentials, optionally populated by pasting
its Request Details JSON. Tai accepts the customer's site code and API key and
checks its read-only Broker API before saving. Credentials stay server-side,
encrypted; catalog and administrative APIs only return status and account labels.

**Verification is not synchronization.** The existing Rose worker only discovers
order document IDs using its configured pilot account. It does not use the saved
customer credentials to automatically audit PDFs. Tai currently has connection
verification, not an importer. The UI explicitly says to continue email intake.
No one-click OAuth application or universal document sync is claimed by this PR.

McLeod, Turvo, Aljex, AscendTMS and MercuryGate expose an assisted setup request,
not a pretend connection form. Requests persist per company/provider and appear
in Administration → Integrações TMS. Owners can cancel requests or disconnect.
Administrators coordinate vendor provisioning and data mapping through the normal
support workflow. Saving a request does not automatically send an external message.

## Research (2026-09-22)

This is a North American brokerage-oriented shortlist, not a measured market-share
ranking. Vendors publish different product, version, license and account requirements.

| TMS | Verified public integration information | This implementation / outstanding dependency |
| --- | --- | --- |
| Rose Rocket | [OAuth / service-account guide](https://roserocket.readme.io/docs/rose-rocket-api-oauth-20-authentication-guide), [getting started](https://roserocket.readme.io/docs/getting-started) | Service-account token exchange + read-only `/api/v1/me`; one-paste setup. A consent-only OAuth flow needs an Olympian application provisioned by Rose, registered callback, refresh-token handling and tenant identity validation. Document ingestion still needs development and a licensed test account. |
| Tai | [API keys](https://docs.taicloud.net/docs/obtaining-an-api-key), [Broker reference endpoint](https://docs.taicloud.net/reference/publicapibroker_getshipmentreferencetypes), [site-specific URL](https://learn.tai-software.com/knowledge/tai-public-api) | Real read-only `GET /PublicApi/Broker/v2/ShipmentReferenceTypes`, `x-api-key`, JSON array per OpenAPI. Requires enabled Broker API permissions. Webhooks, document retrieval and audit mapping are not implemented. |
| McLeod PowerBroker / LoadMaster | [integrations](https://www.mcleodsoftware.com/solutions/integrations/), [authentication](https://tms-map.mcleodhosted.com/ws/docs/auth?role=-1) | Supports Basic or registered bearer tokens. Needs licensed web services, customer-specific endpoint, version and schema. No unverified endpoint guessed; assisted request only. |
| Turvo | [integration hub](https://turvo.com/connect/), [API license](https://turvo.com/turvo-api-license-agreement/) | API access, approved application and account contract required; assisted request only. |
| Descartes Aljex | [API / EDI integrations](https://www.aljex.com/integrations/) | Arrange account data exchange and mapping with vendor; assisted request only. |
| AscendTMS | [integration team](https://www.thefreetms.com/about-us) | No public self-service authentication contract validated in this research; assisted request only. |
| MercuryGate | [partnerships](https://partners.mercurygate.com/) | Account-specific integration access and mapping; assisted request only. |

## Deployment

1. Run the normal database migration process, including `038_tms_connections.sql`,
   before serving the new catalog. The SQL is tested in a disposable local database.
2. Configure `ROSE_ROCKET_CREDENTIAL_KEY` and `TMS_CREDENTIAL_KEY` as **separate**
   32-byte random values encoded as base64url in the deployment secret store.
   Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
   Do not commit values or rotate an existing Rose key without re-encrypting saved
   credentials. Keys must persist across restarts and be backed up securely.
3. Change an existing `ROSE_ROCKET_CONNECT_ENABLED=false` to `true`. If unset,
   Rose credential setup is automatically available once its encryption key is valid.
   The explicit false value remains a kill switch for new setup, not disconnect.
4. Deploy the application and static assets together. Missing keys produce an
   actionable support message; no provider credentials are transmitted or stored.
5. Test with an authorized customer account in each vendor. Automated tests mock
   vendor responses; they do not certify live accounts or automatic document import.

No production secrets or migrations were changed as part of preparing this PR.

## Security and operations

- Company membership, owner/billing-admin role, active tenant, existing CSRF/origin,
  sensitive-operation MFA (when enabled) and rate limits apply to mutations.
- Tai URLs are constructed from a strict site-code allowlist under `taicloud.net`;
  HTTPS, bounded timeouts, no redirects and bounded JSON responses are enforced.
- New credentials use AES-256-GCM with company/provider authenticated context.
  Rose retains its existing encryption format for compatibility.
- Provider errors do not expose upstream bodies or credentials. Failed verification
  does not replace the previous saved connection.
- Disconnect clears encrypted credentials and verification metadata, preserving audits.
  Completed account erasure also clears saved Tai and Rose credentials through a database trigger.
- Both connection tables deny direct authenticated/anonymous access. Only the
  service role can read or mutate them; the administrative API selects no secrets.
- Existing Rose connection metadata remains visible even when new setup is paused.

## Validation

Run `npm run typecheck`, `npm test`, `npm run build` and
`node scripts/check-db-isolated.cjs` (requires local PostgreSQL binaries).
The added tests cover provider failures, unsafe URLs, ciphertext tampering,
cross-company access, management permissions, requests, persistence failures,
disconnect, administrative access and database privilege constraints.
