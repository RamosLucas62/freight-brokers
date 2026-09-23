import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {RoseRocketServiceAccount} from './rose-rocket.js';

function key():Buffer{
 const encoded=process.env.ROSE_ROCKET_CREDENTIAL_KEY??'';
 if(!/^[A-Za-z0-9_-]{43}=?$/.test(encoded))throw new Error('ROSE_CREDENTIAL_KEY_REQUIRED');
 const decoded=Buffer.from(encoded,'base64url');
 if(decoded.length!==32)throw new Error('ROSE_CREDENTIAL_KEY_INVALID');
 return decoded;
}

export function roseCredentialsReady():boolean{try{key();return true;}catch{return false;}}

export function encryptRoseCredentials(account:RoseRocketServiceAccount):string{
 const nonce=randomBytes(12);
 const cipher=createCipheriv('aes-256-gcm',key(),nonce);
 const bytes=Buffer.concat([cipher.update(JSON.stringify(account),'utf8'),cipher.final()]);
 return `v1.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${bytes.toString('base64url')}`;
}

export function decryptRoseCredentials(value:string):RoseRocketServiceAccount{
 const [version,nonce,tag,bytes,...rest]=value.split('.');
 if(version!=='v1'||!nonce||!tag||!bytes||rest.length)throw new Error('ROSE_CREDENTIALS_INVALID');
 const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(nonce,'base64url'));
 decipher.setAuthTag(Buffer.from(tag,'base64url'));
 const account=JSON.parse(Buffer.concat([decipher.update(Buffer.from(bytes,'base64url')),decipher.final()]).toString('utf8')) as RoseRocketServiceAccount;
 if(!account.clientId||!account.clientSecret||!account.orgId||!account.userId)throw new Error('ROSE_CREDENTIALS_INVALID');
 return account;
}
