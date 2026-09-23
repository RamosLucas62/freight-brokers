import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

function key():Buffer{
 const value=process.env.TMS_CREDENTIAL_KEY??'';
 if(!/^[A-Za-z0-9_-]{43}=?$/.test(value))throw new Error('TMS_CREDENTIAL_KEY_REQUIRED');
 const decoded=Buffer.from(value,'base64url');
 if(decoded.length!==32)throw new Error('TMS_CREDENTIAL_KEY_INVALID');
 return decoded;
}
export function tmsCredentialsReady():boolean{try{key();return true;}catch{return false;}}
/** Bind encrypted credentials to both the company and provider to prevent row swapping. */
export function encryptTmsCredentials(tenant:string,provider:string,credentials:unknown):string{
 const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),nonce);
 cipher.setAAD(Buffer.from(`${tenant}:${provider}`));
 const encrypted=Buffer.concat([cipher.update(JSON.stringify(credentials),'utf8'),cipher.final()]);
 return ['v1',nonce.toString('base64url'),cipher.getAuthTag().toString('base64url'),encrypted.toString('base64url')].join('.');
}
export function decryptTmsCredentials(tenant:string,provider:string,value:string):unknown{
 const [version,nonce,tag,bytes,...rest]=value.split('.');
 if(version!=='v1'||!nonce||!tag||!bytes||rest.length)throw new Error('TMS_CREDENTIALS_INVALID');
 const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(nonce,'base64url'));
 decipher.setAAD(Buffer.from(`${tenant}:${provider}`));decipher.setAuthTag(Buffer.from(tag,'base64url'));
 return JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes,'base64url')),decipher.final()]).toString('utf8'));
}
