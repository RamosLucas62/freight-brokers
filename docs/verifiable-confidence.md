# Verifiable invoice confidence

Invoice confidence is calculated from observable signals; the model does not assign its own probability.

For every extracted field, the OpenRouter contract requires a source page and a short source snippet. The verification engine then checks presence, format, source support and agreement with prior tenant history. It produces one of three states:

- `verified`: the required evidence passed the configured threshold and the document can continue automatically;
- `unverifiable`: required information is absent, so the system does not infer an accusation;
- `review`: present evidence is invalid, conflicting or insufficient.

Bank details are optional when absent. If they are present, they must be supported and valid. A carrier identifier can be either MC or DOT.

## Configuration

- `CONFIDENCE_VERIFIED_THRESHOLD` defaults to `0.92` and must remain between 0 and 1.
- `CONFIDENCE_QA_SAMPLE_RATE` defaults to `0.05`, selecting a deterministic 5% sample of verified documents for continuous quality review. Set it to `0` only in automated tests.

Apply `db/migrations/023_verifiable_confidence.sql` before deploying the application. The migration persists each invoice's verification details and creates `audit_confidence_reviews`. Verified documents selected for quality control are inserted into that queue automatically.

The audit report records verified, review and unverifiable counts, field-level totals, QA sample count and the observed automation rate. The same summary is emitted as the structured `audit.confidence.measured` log event.

## Calibration workflow

1. Run the labeled invoice set through the production extraction contract.
2. Review the deterministic sample in `audit_confidence_reviews`.
3. Mark a sample `confirmed` when all critical fields are correct or `corrected` with the corrected fields.
4. Measure false automation and false review rates by field before changing the threshold.
5. Increase automation only after the labeled set and ongoing sample meet the agreed precision target.

Do not replace the verification score with model self-reported confidence. A model response is evidence input, not the ground truth.
