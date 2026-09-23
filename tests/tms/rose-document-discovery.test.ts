import {describe,it,expect,vi} from 'vitest';
import {RoseRocketClient} from '../../src/tms/rose-rocket.js';
import {RoseDocumentConnector} from '../../src/tms/rose-sync.js';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account={orgId:id(1),userId:id(2),clientId:'app',clientSecret:'secret'};
const doc=(n:number)=>({id:id(n),file:{id:id(n+100)},fileName:`evidence-${n}.pdf`,mimeType:'application/pdf'});
function setup(overrides:Record<string,unknown>={}){
 const objects:Record<string,unknown>={
  [id(3)]:{id:id(3),orgId:id(1),objectKey:'order',manifests:[{id:id(4)},{id:id(4)}],documents:[doc(10)]},
  [id(4)]:{id:id(4),orgId:id(1),objectKey:'manifest',bill:{id:id(5)},documents:[doc(11),doc(10)]},
  [id(5)]:{id:id(5),orgId:id(1),objectKey:'bill',documents:[doc(12),{...doc(13),isSystemGenerated:true},{...doc(14),documentType:'complianceCargo'},{id:id(15),externalUrl:`/api/v2/platformModel/documents/bill/${id(5)}/pdf`}]},...overrides,
 };
 const fetcher=vi.fn(async(url:unknown)=>{
  if(String(url).endsWith('/oauth/token'))return Response.json({access_token:'token'});
  const target=new URL(String(url));const object=objects[target.pathname.split('/').pop()!];
  if(!object)return new Response('',{status:404});return Response.json(object);
 });
 return {connector:new RoseDocumentConnector(new RoseRocketClient({account,fetcher})),fetcher};
}
describe('Rose related evidence discovery',()=>{
 it('follows documented order → manifest → bill links, deduplicates files and excludes generated accounting records',async()=>{
  const {connector,fetcher}=setup();const record=await connector.record(id(3));
  expect(record.documents.map(d=>d.filename)).toEqual(['evidence-10.pdf','evidence-11.pdf','evidence-12.pdf']);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(String(fetcher.mock.calls[1][0])).toContain('paths=documents.file,documents.externalUrl,manifests');
  expect(String(fetcher.mock.calls[2][0])).toContain('paths=documents.file,documents.externalUrl,bill');
 });
 it('does not accept a related bill from a different organization',async()=>{
  const {connector}=setup({[id(5)]:{id:id(5),orgId:id(99),objectKey:'bill',documents:[doc(12)]}});
  await expect(connector.record(id(3))).rejects.toThrow('ROSE_OBJECT_SCOPE_MISMATCH');
 });
 it('fails instead of silently returning an incomplete package when a related bill is inaccessible',async()=>{
  const {connector}=setup({[id(5)]:null});await expect(connector.record(id(3))).rejects.toThrow('ROSE_API_HTTP_404');
 });
 it('rejects malformed references rather than skipping required evidence',async()=>{
  const {connector}=setup({[id(3)]:{id:id(3),orgId:id(1),objectKey:'order',manifests:[{id:'bad'}]}});
  await expect(connector.record(id(3))).rejects.toThrow();
 });
 it('bounds aggregate attachment discovery across related objects',async()=>{
  const {connector}=setup({[id(5)]:{id:id(5),orgId:id(1),objectKey:'bill',documents:Array.from({length:100},(_,n)=>doc(n+200))}});
  await expect(connector.record(id(3))).rejects.toThrow('ROSE_DOCUMENT_LIMIT');
 });
});
