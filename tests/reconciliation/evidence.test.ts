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
  expect(tmsEvidenceIssues([invoice],[pod(),pod()],[rate()])[0].missing).toEqual(expect.arrayContaining(['AMBIGUOUS_POD','ACCESSORIAL_DOCUMENT','ACCESSORIAL_EVIDENCE_REVIEW']));
 });
 it('checks every invoice rather than presence of any POD and rate confirmation',()=>{
  expect(tmsEvidenceIssues([makeInvoice(),makeInvoice({numero_carga:'LOAD-2'})],[pod()],[rate()])).toEqual([{load:'LOAD-2',missing:['POD','RATE_CONFIRMATION']}]);
 });
});

it('retains a terms-review requirement even when matching receipt evidence is present',()=>{
 const invoice=makeInvoice();invoice.accessorials[0].tipo='LUMPER';
 const receipt={fields:{load_number:field('LOAD-9876')}} as any;
 expect(tmsEvidenceIssues([invoice],[pod()],[rate()],.9,[receipt])[0].missing).toContain('ACCESSORIAL_EVIDENCE_REVIEW');
 receipt.fields.load_number=field('ANOTHER-LOAD');
 expect(tmsEvidenceIssues([invoice],[pod()],[rate()],.9,[receipt])[0].missing).toContain('ACCESSORIAL_DOCUMENT');
});
it('allows fixed additional charges only after their receipt, contract and currency match',()=>{
 const invoice=makeInvoice({currency:'USD',verification:{fields:{currency:{status:'verified'}}} as any,accessorials:[{tipo:'LUMPER',descricao:'Lumper',valor:150,pagina:1,confidence:.99,posicao:null,evidence:{page:1,text:'Lumper 150.00'}}]});
 const r=rate();r.fields.currency=field('USD');r.fields.carrier_name=field(invoice.carrier_name!);r.fields.accessorials=[{type:'LUMPER',description:'Lumper',amount:150,confidence:.99,evidence:field(150).evidence}];
 const receipt={source_file:'receipt.pdf',requires_human_review:false,fields:{load_number:field('LOAD-9876'),charge_type:field('LUMPER'),record_kind:field('receipt'),amount:field(150),currency:field('USD'),service_date:field('2026-09-22')}} as any;
 expect(tmsEvidenceIssues([invoice],[pod()],[r],.9,[receipt])).toEqual([]);
 receipt.fields.amount=field(151);expect(tmsEvidenceIssues([invoice],[pod()],[r],.9,[receipt])[0].missing).toContain('ACCESSORIAL_RECEIPT_AMOUNT');
});
