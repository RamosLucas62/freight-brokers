import {describe,it,expect} from 'vitest';
import {tmsEvidenceIssues} from '../../src/reconciliation/evidence.js';
import {makeInvoice} from '../fixtures/invoice.fixture.js';
import type {PodExtractionResult} from '../../src/pod/types.js';
import type {RateConfirmationExtractionResult} from '../../src/rate-confirmation/types.js';
const field=<T>(value:T)=>({value,confidence:0.99,evidence:{page:1,text:String(value),bounding_box:null}});
const pod=()=>({fields:{load_number:field('LOAD-9876'),signature_present:field(true),delivery_date:field('2026-09-22')},requires_human_review:false} as PodExtractionResult);
const rate=()=>({fields:{load_number:field('LOAD-9876'),total_amount:field(2500)},requires_human_review:false} as RateConfirmationExtractionResult);
describe('TMS evidence readiness',()=>{
 it('requires invoices and both matching supporting documents',()=>{
  expect(tmsEvidenceIssues([],[],[])[0].missing).toContain('CARRIER_INVOICE');
  expect(tmsEvidenceIssues([makeInvoice()],[],[])[0].missing).toEqual(['POD','RATE_CONFIRMATION']);
  expect(tmsEvidenceIssues([makeInvoice()],[pod()],[rate()])).toEqual([]);
 });
 it('does not mistake an unrelated load or low-confidence evidence for completeness',()=>{
  const p=pod();p.fields.load_number=field('OTHER');const r=rate();r.fields.load_number.confidence=.5;
  expect(tmsEvidenceIssues([makeInvoice()],[p],[r])[0].missing).toEqual(['POD','RATE_CONFIRMATION']);
 });
 it('requires a signature, source evidence and authorized total',()=>{
  const p=pod();p.fields.signature_present=field(false);p.fields.delivery_date.evidence=null;const r=rate();r.fields.total_amount.confidence=.5;
  expect(tmsEvidenceIssues([makeInvoice()],[p],[r])[0].missing).toEqual(['SIGNED_POD','DELIVERY_DATE','AUTHORIZED_TOTAL']);
 });
 it('holds ambiguous documents and additional charges for review',()=>{
  const invoice=makeInvoice();invoice.accessorials[0].tipo='DETENTION';
  expect(tmsEvidenceIssues([invoice],[pod(),pod()],[rate()])[0].missing).toEqual(['AMBIGUOUS_POD','ACCESSORIAL_EVIDENCE_REVIEW']);
 });
 it('checks every invoice rather than presence of any POD and rate confirmation',()=>{
  expect(tmsEvidenceIssues([makeInvoice(),makeInvoice({numero_carga:'LOAD-2'})],[pod()],[rate()])).toEqual([{load:'LOAD-2',missing:['POD','RATE_CONFIRMATION']}]);
 });
});
