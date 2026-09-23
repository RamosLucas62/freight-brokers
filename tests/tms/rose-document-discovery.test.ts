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
it('imports only generated manifest rate PDFs and fingerprints their actual bytes',async()=>{
 const fetcher=vi.fn(async(url:unknown)=>{
  const path=String(url);if(path.endsWith('/oauth/token'))return Response.json({access_token:'token'});
  if(path.includes('/documents/'))return new Response('%PDF-rate-version-one');
  if(path.includes(`/objects/${id(3)}`))return Response.json({id:id(3),orgId:id(1),objectKey:'order',manifests:[{id:id(4)}]});
  return Response.json({id:id(4),orgId:id(1),objectKey:'manifest',documents:[{id:id(10),externalUrl:`/api/v2/platformModel/documents/manifest/${id(4)}/rate_con/pdf`},{id:id(11),externalUrl:`/api/v2/platformModel/documents/invoice/${id(5)}/pdf`}]});
 });
 const record=await new RoseDocumentConnector(new RoseRocketClient({account,fetcher})).record(id(3));
 expect(record.documents).toHaveLength(1);expect(record.documents[0].filename).toContain('rate_confirmation');expect(record.documents[0].revision).toMatch(/^[a-f0-9]{64}$/);expect((await record.documents[0].download()).toString()).toBe('%PDF-rate-version-one');
 expect(fetcher.mock.calls.some(c=>String(c[0]).includes('/documents/invoice/'))).toBe(false);
});
it('uses documented bounded board search for historical order discovery',async()=>{
 const fetcher=vi.fn(async(url:unknown,options:any)=>{if(String(url).endsWith('/oauth/token'))return Response.json({access_token:'token'});expect(JSON.parse(options.body)).toEqual({boardId:id(9),orderByPath:'id',orderByDirection:'asc',limit:1000});return Response.json({total:1,results:[{id:id(3),objectKey:'order'}]});});
 expect(await new RoseRocketClient({account:{...account,historyBoardId:id(9)},fetcher}).historicalOrderIds()).toEqual([id(3)]);
});
it.each([{total:2,results:[{id:id(3),objectKey:'order'}]},{total:1,results:[{id:id(3),objectKey:'invoice'}]},{total:2,results:[{id:id(3),objectKey:'order'},{id:id(3),objectKey:'order'}]}])('fails closed on incomplete or incorrect historical results',async payload=>{
 const fetcher=vi.fn(async(url:unknown)=>String(url).endsWith('/oauth/token')?Response.json({access_token:'token'}):Response.json(payload));
 await expect(new RoseRocketClient({account:{...account,historyBoardId:id(9)},fetcher}).historicalOrderIds()).rejects.toThrow();
});
