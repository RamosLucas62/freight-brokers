import {limitedBody} from '../inbound/resend.js';
import {z} from 'zod';

const Scan=z.object({safe:z.boolean(),page_count:z.number().int().nonnegative().max(500),reason:z.string().max(100).optional()});
export async function scanPdf(bytes:Buffer):Promise<{pageCount:number}>{
 const url=process.env.PDF_SCAN_URL;const token=process.env.PDF_SCAN_TOKEN;
 if(!url||!token){if(process.env.NODE_ENV==='production')throw new Error('PDF_SCANNER_REQUIRED');return {pageCount:0};}
 const target=new URL('/scan',url);if(!['http:','https:'].includes(target.protocol))throw new Error('PDF_SCANNER_INVALID');
 const response=await fetch(target,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/pdf','Content-Length':String(bytes.length)},body:new Uint8Array(bytes),signal:AbortSignal.timeout(20000)});
 const result=Scan.parse(JSON.parse((await limitedBody(response,16384)).toString('utf8')));
 if(!result.safe)throw new Error(`PDF_REJECTED_${result.reason??'UNSAFE'}`);
 return {pageCount:result.page_count};
}
