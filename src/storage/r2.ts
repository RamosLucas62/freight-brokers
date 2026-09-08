import {DeleteObjectsCommand,GetObjectCommand,PutObjectCommand,S3Client} from '@aws-sdk/client-s3';

export interface R2Config {
 accountId:string;
 accessKeyId:string;
 secretAccessKey:string;
 bucket:string;
}

let client:S3Client|undefined;

function configFromEnvironment():R2Config {
 const accountId=process.env.R2_ACCOUNT_ID;
 const accessKeyId=process.env.R2_ACCESS_KEY_ID;
 const secretAccessKey=process.env.R2_SECRET_ACCESS_KEY;
 const bucket=process.env.R2_BUCKET_NAME;
 if(!accountId || !accessKeyId || !secretAccessKey || !bucket)throw new Error('R2_CONFIGURATION_MISSING');
 return {accountId,accessKeyId,secretAccessKey,bucket};
}

function getClient(config:R2Config) {
 client??=new S3Client({
  region:'auto',
  endpoint:`https://${config.accountId}.r2.cloudflarestorage.com`,
  credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey},
 });
 return client;
}

function safeSegment(value:string) {
 return encodeURIComponent(value);
}

export function invoiceObjectKey(tenantId:string,jobId:string,attachmentId:string) {
 return `invoices/${safeSegment(tenantId)}/${safeSegment(jobId)}/${safeSegment(attachmentId)}.pdf`;
}

export function freeAuditObjectKey(requestId:string,attachmentId:string) {
 return `free-audits/${safeSegment(requestId)}/${safeSegment(attachmentId)}.pdf`;
}

export async function putInvoiceObject(key:string,bytes:Buffer) {
 const config=configFromEnvironment();
 await getClient(config).send(new PutObjectCommand({
  Bucket:config.bucket,Key:key,Body:bytes,ContentType:'application/pdf',CacheControl:'private, no-store',
 }));
}

export async function getPrivateObject(key:string,maxBytes=20*1024*1024):Promise<Buffer> {
 const config=configFromEnvironment();
 const result=await getClient(config).send(new GetObjectCommand({Bucket:config.bucket,Key:key}));
 if(!result.Body || Number(result.ContentLength??0)>maxBytes)throw new Error('STORED_ATTACHMENT_TOO_LARGE');
 const bytes=Buffer.from(await result.Body.transformToByteArray());
 if(bytes.length>maxBytes)throw new Error('STORED_ATTACHMENT_TOO_LARGE');
 return bytes;
}

export async function deleteInvoiceObjects(keys:string[]) {
 if(!keys.length)return;
 const config=configFromEnvironment();
 for(let offset=0;offset<keys.length;offset+=1000){
  const result=await getClient(config).send(new DeleteObjectsCommand({Bucket:config.bucket,Delete:{Objects:keys.slice(offset,offset+1000).map(Key=>({Key})),Quiet:true}}));
  if(result.Errors?.length)throw new Error('OBJECT_DELETION_INCOMPLETE');
 }
}

export function resetR2ClientForTests() { client=undefined; }
