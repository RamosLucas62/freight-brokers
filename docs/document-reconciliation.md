# Invoice, rate confirmation and POD reconciliation

The paid inbound email flow classifies each PDF as an invoice, proof of delivery (POD), or rate confirmation. Files with explicit `pod`, `proof of delivery`, `rate con`, or `rate confirmation` names are classified locally; ambiguous names are classified with the configured OpenRouter model. A classification below 0.90 is stopped for human review.

Documents in the same email/job are linked by a high-confidence load number. A missing or uncertain identifier never becomes a mismatch. POD and rate-confirmation extractions are cached on the private attachment record, while only accepted invoices count toward monthly usage.

The reconciliation emits three exception types:

- `RATE_CONFIRMATION_MISMATCH`: a high-confidence carrier or total differs from the invoice.
- `UNSUPPORTED_ACCESSORIAL`: an invoice accessorial is absent from, or exceeds, the matched rate confirmation.
- `UNBILLED_ACCESSORIAL`: the rate confirmation authorizes an amount, the invoice omits it, and high-confidence POD notes independently show that service was performed.

Potential unbilled revenue is deliberately conservative. An authorized rate alone does not prove the service was earned. If the POD is missing, uncertain, degraded, or lacks explicit evidence, the result is `unverifiable` and no revenue value is claimed.

The report includes reconciliation counts, potential unbilled revenue, supporting-document references and evidence. The original standalone POD command remains available for PDF, JPEG, PNG, WebP, CSV and XLSX:

```sh
npm run pod:process -- document.pdf
```

Automatic email reconciliation currently accepts PDF attachments. Image and spreadsheet PODs can be normalized through the standalone command before being added to an automated job. Apply migration `015_supporting_document_reconciliation.sql` before deploying.

Operational accuracy must be calibrated against a labeled set of real invoices, rate confirmations and degraded PODs. Model confidence is not a calibrated probability, and signature presence does not authenticate the signer.
