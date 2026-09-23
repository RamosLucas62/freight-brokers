import {describe,it,expect} from 'vitest';
import {verifyAccessorials} from '../../src/accessorial/verify.js';
import {makeInvoice} from '../fixtures/invoice.fixture.js';
import type {AccessorialExtractionResult} from '../../src/accessorial/schema.js';
const f=<T>(value:T)=>({value,confidence:.99,evidence:{page:1,text:String(value),bounding_box:null}});
const invoice=()=>makeInvoice({currency:'USD',verification:{fields:{currency:{status:'verified'}}} as any,accessorials:[{tipo:'LUMPER',descricao:'Lumper',valor:150,pagina:1,confidence:.99,posicao:null,evidence:{page:1,text:'LUMPER USD 150.00'}}]});
const doc=(kind='receipt')=>({source_file:`${kind}.pdf`,requires_human_review:false,raw:{},fields:{load_number:f('LOAD-9876'),charge_type:f('LUMPER'),record_kind:f(kind),amount:f(150),currency:f('USD'),service_date:f('2026-09-22'),arrival_at:f(null),departure_at:f(null),authorized_by:f('Broker dispatcher'),carrier_name:f('SWIFT TRANSPORT LLC'),hourly_rate:f(null),free_minutes:f(null),rounding_minutes:f(null),maximum_amount:f(null)}} as AccessorialExtractionResult);
const rate=()=>({source_file:'rate.pdf',requires_human_review:false,fields:{currency:f('USD'),carrier_name:f('SWIFT TRANSPORT LLC'),accessorials:[{type:'LUMPER',amount:150,confidence:.99,evidence:f(150).evidence}]}} as any);
const check=(docs:AccessorialExtractionResult[],i=invoice(),r=rate())=>verifyAccessorials(i,r,docs,.9,'2026-09-22')[0];
describe('contract-backed additional charges',()=>{
 it('verifies a fixed receipt against explicit rate amount and currency',()=>{expect(check([doc()])).toMatchObject({status:'verified',expected:150,sources:['receipt.pdf','rate.pdf']});});
 it('accepts an explicit load/carrier/date/currency authorization',()=>{expect(check([doc(),doc('authorization')],invoice(),undefined)).toMatchObject({status:'verified',expected:150});});
 it.each(['currency','amount','load_number','service_date'])('does not approve mismatched receipt %s',field=>{const d=doc();(d.fields as any)[field]=f(field==='amount'?200:field==='currency'?'CAD':field==='service_date'?'2026-09-21':'OTHER');expect(check([d]).status).toBe('review');});
 it('requires verifiable invoice currency and charge source',()=>{const i=invoice();delete i.verification;i.accessorials[0].evidence=null;expect(check([doc()],i).reasons).toEqual(expect.arrayContaining(['INVOICE_CURRENCY','CHARGE_SOURCE']));});
 it('does not reuse a receipt for repeated charges',()=>{const i=invoice();i.accessorials.push({...i.accessorials[0]});expect(check([doc()],i).reasons).toContain('AMBIGUOUS_CHARGES');});
 it('rejects duplicate or low-confidence receipt candidates',()=>{expect(check([doc(),doc()]).reasons).toContain('AMBIGUOUS_RECEIPT');const d=doc();d.fields.load_number.confidence=.5;expect(check([d]).reasons).toContain('RECEIPT');});
 it('rejects an authorization for another carrier',()=>{const d=doc('authorization');d.fields.carrier_name=f('OTHER');expect(check([doc(),d]).reasons).toContain('AUTHORIZATION');});
 it('does not authorize from a contract for another carrier',()=>{const r=rate();r.fields.carrier_name=f('OTHER');expect(check([doc()],invoice(),r).reasons).toContain('AUTHORIZATION');});
 it('keeps unknown and cancellation terms in review',()=>{const i=invoice();i.accessorials[0].tipo='TONU';expect(check([doc()],i).reasons).toContain('UNSUPPORTED_TERMS');});
});
describe('hourly detention calculation',()=>{
 function fixture(){const i=invoice();i.accessorials[0]={...i.accessorials[0],tipo:'DETENTION',valor:125,evidence:{page:1,text:'DETENTION 125.00'}};const time=doc('time_record'),auth=doc('authorization');for(const d of [time,auth])d.fields.charge_type=f('DETENTION');time.fields.arrival_at=f('2026-09-22T10:00:00-05:00');time.fields.departure_at=f('2026-09-22T14:10:00-05:00');auth.fields.hourly_rate=f(50);auth.fields.free_minutes=f(120);auth.fields.rounding_minutes=f(30);return {i,time,auth};}
 it('subtracts free time, rounds only by explicit increments, and compares cents',()=>{const {i,time,auth}=fixture();expect(check([time,auth],i)).toMatchObject({status:'verified',expected:125});});
 it('respects an explicitly evidenced cap',()=>{const {i,time,auth}=fixture();auth.fields.maximum_amount=f(100);i.accessorials[0].valor=100;i.accessorials[0].evidence!.text='DETENTION 100.00';expect(check([time,auth],i)).toMatchObject({status:'verified',expected:100});});
 it('does not assume a default free period or rounding rule',()=>{const {i,time,auth}=fixture();auth.fields.rounding_minutes=f(null);expect(check([time,auth],i).reasons).toContain('TIME_TERMS');});
 it('rejects reversed time ranges',()=>{const {i,time,auth}=fixture();time.fields.departure_at=f('2026-09-22T09:00:00-05:00');expect(check([time,auth],i).reasons).toContain('TIME_RANGE');});
 it('does not approve a billed amount that differs from the calculated value',()=>{const {i,time,auth}=fixture();i.accessorials[0].valor=150;i.accessorials[0].evidence!.text='DETENTION 150.00';expect(check([time,auth],i).reasons).toContain('AMOUNT_MISMATCH');});
});
