import type {IncomingMessage,ServerResponse} from 'node:http';

export class HttpError extends Error {constructor(public status:number,public code:string){super(code);}}

export async function readBody(req:IncomingMessage,limit:number):Promise<Buffer>{
 const declared=Number(req.headers['content-length']??0);
 if(!Number.isFinite(declared)||declared<0||declared>limit)throw new HttpError(413,'payload_too_large');
 let size=0;const chunks:Buffer[]=[];
 for await(const chunk of req){size+=chunk.length;if(size>limit)throw new HttpError(413,'payload_too_large');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
export async function readResponseBody(response:Response,limit:number):Promise<Buffer>{
 if(!response.ok||!response.body)throw new HttpError(response.status||502,'upstream_failed');
 const reader=response.body.getReader();const chunks:Buffer[]=[];let size=0;
 try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit)throw new HttpError(502,'upstream_payload_too_large');chunks.push(Buffer.from(part.value));}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks);
}

export function securityHeaders(res:ServerResponse):void{
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=(), payment=()');
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');
 res.setHeader('Cross-Origin-Resource-Policy','same-origin');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://challenges.cloudflare.com; script-src-attr 'none'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
 if(process.env.NODE_ENV==='production')res.setHeader('Strict-Transport-Security','max-age=63072000; includeSubDomains; preload');
}
