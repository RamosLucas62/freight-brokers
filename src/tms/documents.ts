import {z} from 'zod';
import {limitedBody} from '../inbound/resend.js';

export interface TmsDocument {id:string;filename:string;revision:string;download:()=>Promise<Buffer>;}
export interface TmsRecord {id:string;documents:TmsDocument[];}
export interface DocumentConnector {
 records():AsyncIterable<TmsRecord>;
 record(id:string):Promise<TmsRecord>;
}
export async function readJson(response:Response):Promise<unknown>{
 if(!response.ok){await response.body?.cancel();throw new Error(`TMS_HTTP_${response.status}`);}
 if(!/^(application|text)\/json\b/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw new Error('TMS_INVALID_JSON');}
 return JSON.parse((await limitedBody(response,8*1024*1024)).toString('utf8'));
}
export async function readPdf(response:Response):Promise<Buffer>{
 if(!response.ok){await response.body?.cancel();throw new Error(`TMS_HTTP_${response.status}`);}
 const bytes=await limitedBody(response,20*1024*1024);
 if(!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('TMS_NOT_PDF');
 return bytes;
}
export const remoteId=z.string().min(1).max(200);
export function safeFilename(value:string):string{return value.split(/[/\\]/).pop()?.replace(/[\x00-\x1f]/g,'').slice(0,200)||'document.pdf';}
