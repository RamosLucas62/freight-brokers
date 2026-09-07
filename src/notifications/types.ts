export type NotificationKind='immediate'|'daily'|'monthly';

export interface NotificationDelivery {
 id:string;
 tenant_id:string;
 kind:NotificationKind;
 period_key:string;
 period_start:string;
 period_end:string;
 exception_id:string|null;
 attempts:number;
}

export interface NotificationException {
 id:string;
 invoice_id:string;
 tipo_regra:string;
 valor_envolvido:number|null;
 descricao:string;
 source_file:string;
 source_page:number|null;
 created_at:string;
 resolution_status:'pending'|'avoided'|'no_loss';
 avoided_amount:number|null;
 resolved_at:string|null;
 invoice?:{
  numero_fatura:string|null;
  numero_carga:string|null;
  carrier_name:string|null;
  valor_total:number|null;
 };
}

export interface NotificationData {
 delivery:NotificationDelivery;
 companyName:string;
 timezone:string;
 recipients:string[];
 risks:NotificationException[];
 avoided:NotificationException[];
}
