import {describe,expect,it} from 'vitest';
import {reconcileDocuments} from '../../src/reconciliation/reconcile.js';
import type {InvoiceRecord} from '../../src/types/invoice.types.js';
import type {PodExtractionResult,PodField} from '../../src/pod/types.js';
import type {RateConfirmationExtractionResult} from '../../src/rate-confirmation/types.js';

const field=<T>(value:T|null,confidence=1,text:string|null=null):PodField<T>=>({value,confidence,evidence:value==null?null:{page:1,text,bounding_box:null}});
const invoice=(accessorials:InvoiceRecord['accessorials']=[],total=1000):InvoiceRecord=>({id:'invoice-1',source_file:'invoice.pdf',numero_fatura:'INV-1',numero_carga:'LOAD-42',carrier_name:'Carrier LLC',mc_number:null,dot_number:null,data_carga:null,data_fatura:null,valor_total:total,origem:'A',destino:'B',dados_bancarios:null,accessorials,confidence_scores:{},extraction_raw:{},created_at:'2026-09-08T00:00:00Z'});
const pod=(notes='detention performed',confidence=1):PodExtractionResult=>({source_file:'pod.pdf',source_kind:'ocr',fields:{load_number:field('LOAD-42'),bol_number:field(null),delivery_date:field('2026-09-01'),delivery_time:field('10:00'),receiver_name:field('Jane'),delivery_location:field('B'),signature_present:field(true),damage_or_shortage_noted:field(false),exception_notes:field(notes,confidence,notes)},quality:{score:1,rotation_degrees:0,perspective_distortion:false,blur:false,glare_or_shadow:false,cropped:false,reasons:[]},requires_human_review:false,raw:{}});
const rate=(accessorials:RateConfirmationExtractionResult['fields']['accessorials']=[],total=1000):RateConfirmationExtractionResult=>({source_file:'rate.pdf',fields:{load_number:field('LOAD-42'),bol_number:field(null),carrier_name:field('Carrier LLC'),origin:field('A'),destination:field('B'),linehaul_amount:field(900),total_amount:field(total),accessorials},requires_human_review:false,raw:{}});

describe('invoice, POD and rate confirmation reconciliation',()=>{
 it('confirms matching documents without manufacturing exceptions',()=>{const result=reconcileDocuments([invoice()],[pod('')],[rate()]);expect(result.exceptions).toEqual([]);expect(result.summary).toMatchObject({matched:1,divergent:0,unverifiable:0});});
 it('flags an unsupported billed accessorial',()=>{const result=reconcileDocuments([invoice([{tipo:'DETENTION',descricao:'Detention',valor:150,confidence:1,pagina:1,posicao:null}])],[pod()],[rate()]);expect(result.exceptions[0]).toMatchObject({tipo_regra:'UNSUPPORTED_ACCESSORIAL',valor_envolvido:150});});
 it('flags potential unbilled revenue only with confident POD evidence',()=>{const accessorial={type:'DETENTION',description:'Detention',amount:125,confidence:1,evidence:{page:1,text:'Detention $125',bounding_box:null}};const result=reconcileDocuments([invoice()],[pod('Driver detention performed')],[rate([accessorial])]);expect(result.exceptions[0]).toMatchObject({tipo_regra:'UNBILLED_ACCESSORIAL',valor_envolvido:125});expect(result.summary.unbilled_revenue).toBe(125);});
 it('turns uncertain supporting evidence into unverifiable, never divergence',()=>{const uncertain=pod('detention',0.5);uncertain.requires_human_review=true;const result=reconcileDocuments([invoice()],[uncertain],[rate([],1200)]);expect(result.exceptions).toEqual([]);expect(result.summary.unverifiable).toBe(1);});
 it('flags a high-confidence rate total mismatch',()=>{const result=reconcileDocuments([invoice([],1200)],[pod('')],[rate([],1000)]);expect(result.exceptions[0]).toMatchObject({tipo_regra:'RATE_CONFIRMATION_MISMATCH',valor_envolvido:200});});
});
