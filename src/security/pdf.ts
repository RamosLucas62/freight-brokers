import {z} from 'zod';

const Scan=z.object({safe:z.boolean(),page_count:z.number().int().nonnegative().max(500),reason:z.string().max(100).optional()});
async function scannerBody(response:Response):Promise<Buffer>{
 if(!response.body)throw new Error(`PDF_SCANNER_HTTP_${response.status||502}`);
 const reader=response.body.getReader();const chunks:Buffer[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384)throw new Error('PDF_SCANNER_INVALID_RESPONSE');chunks.push(Buffer.from(part.value));}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks);
}
function reasonCode(value:string|undefined){return (value??'unsafe').replace(/[^a-z0-9_]+/gi,'_').toUpperCase();}
function scannerError(value:string|undefined){const reason=reasonCode(value);return reason.startsWith('SCANNER_')?`PDF_${reason}`:`PDF_SCANNER_${reason}`;}
export async function scanPdf(bytes:Buffer):Promise<{pageCount:number}>{
 const url=process.env.PDF_SCAN_URL;const token=process.env.PDF_SCAN_TOKEN;
 if(!url||!token){if(process.env.NODE_ENV==='production')throw new Error('PDF_SCANNER_REQUIRED');return {pageCount:0};}
 const target=new URL('/scan',url);if(!['http:','https:'].includes(target.protocol))throw new Error('PDF_SCANNER_INVALID');
 let response:Response;
 try{response=await fetch(target,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/pdf','Content-Length':String(bytes.length)},body:new Uint8Array(bytes),signal:AbortSignal.timeout(20000)});}
 catch(error){throw new Error(error instanceof Error&&error.name==='TimeoutError'?'PDF_SCANNER_TIMEOUT':'PDF_SCANNER_UNAVAILABLE');}
 let payload:unknown;try{payload=JSON.parse((await scannerBody(response)).toString('utf8'));}catch(error){if(error instanceof SyntaxError)throw new Error(`PDF_SCANNER_HTTP_${response.status||502}`);throw error;}
 const result=Scan.parse(payload);
 if(response.status>=500)throw new Error(scannerError(result.reason));
 if(!response.ok)throw new Error(`PDF_REJECTED_${reasonCode(result.reason)}`);
 if(!result.safe)throw new Error(`PDF_REJECTED_${result.reason??'UNSAFE'}`);
 return {pageCount:result.page_count};
}
