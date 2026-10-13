import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import postgres from 'postgres';
import {SignJWT} from 'jose';
import {app} from '../src/http/app';
import type {Env} from '../src/env';
import {hash} from '../src/adapters/crypto';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('HTTP contracts with real PostgreSQL',()=>{
 const owner=postgres(url!,{max:1});
 const user=crypto.randomUUID(),secondUser=crypto.randomUUID(),session=crypto.randomUUID(),bank=crypto.randomUUID(),expense=crypto.randomUUID();
 const tokens=new Map<string,string>(),objects=new Map<string,{data:ArrayBuffer;type:string}>();
 let dispatches=0;
 const dbUrl=new URL(url!);dbUrl.username='cv_runtime';dbUrl.password='local-only';
 const authUrl=new URL(url!);authUrl.username='cv_auth';authUrl.password='local-only';
 const env={HYPERDRIVE:{connectionString:dbUrl.toString()},AUTH_HYPERDRIVE:{connectionString:authUrl.toString()},JWT_SECRET:'http-test-secret-32-characters-long-enough',AI_MODEL:'test',AI_MONTHLY_QUOTA:'30',AI_MONTHLY_LIMIT_USD:'100',MAX_STORAGE_BYTES:'8589934592',MAX_DB_BYTES:'838860800',R2_ACCOUNT_ID:'test',R2_BUCKET:'test',R2_ACCESS_KEY_ID:'test',R2_SECRET_ACCESS_KEY:'test',EXTRACTION:{async create(){dispatches++;return {};},async get(){return {};}},DOCUMENTS:{async get(key:string){const o=objects.get(key);return o?{size:o.data.byteLength,httpMetadata:{contentType:o.type},arrayBuffer:async()=>o.data}:null;},async put(key:string,data:ArrayBuffer,options:{httpMetadata:{contentType:string}}){objects.set(key,{data,type:options.httpMetadata.contentType});},async delete(key:string){objects.delete(key);}}} as unknown as Env;
 env.ENVIRONMENT='development';
 const pending:Promise<unknown>[]=[];
 async function request(path:string,method='GET',body?:unknown,key:string=crypto.randomUUID(),identity:string=user){
  return app.fetch(new Request(`https://test.local${path}`,{method,headers:{Authorization:`Bearer ${tokens.get(identity)??''}`,'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)}),env,{waitUntil(p:Promise<unknown>){pending.push(p);},passThroughOnException(){}} as ExecutionContext);
 }
 beforeAll(async()=>{
  await owner`insert into users(id,email,display_name) values(${user},${user+'@http.test'},'A'),(${secondUser},${secondUser+'@http.test'},'B')`;
  await owner`insert into sessions(id,user_id,device_name,expires_at) values(${session},${user},'test',now()+interval '1 day'),(${crypto.randomUUID()},${secondUser},'test',now()+interval '1 day')`;
  const sessions=await owner`select id,user_id from sessions where user_id in (${user},${secondUser})`;
  for(const s of sessions)tokens.set(s.user_id,await new SignJWT({sid:s.id}).setProtectedHeader({alg:'HS256'}).setSubject(s.user_id).setIssuer('cv-financial').setAudience('cv-android').setExpirationTime('1h').sign(new TextEncoder().encode(env.JWT_SECRET)));
  await owner`insert into accounts(id,user_id,name,type,subtype) values(${bank},${user},'BCA','asset','bank'),(${expense},${user},'Makan','expense','category')`;
 });
 afterAll(async()=>{
  await Promise.all(pending);
  await owner.begin(async tx=>{await tx`select set_config('app.purge_user',${user},true)`;await tx`delete from journal_lines where user_id=${user}`;await tx`delete from journal_entries where user_id=${user}`;await tx`delete from drafts where user_id=${user}`;const [storage]=await tx`select coalesce(sum(size_bytes),0)::text total from raw_documents where user_id in (${user},${secondUser})`;await tx`update resource_limits set reserved_storage_bytes=greatest(0,reserved_storage_bytes-${storage.total})`;await tx`delete from users where id in (${user},${secondUser})`;});await owner.end();
 });
 it('requires a valid session and preserves integer wire amounts',async()=>{
  expect((await request('/v1/accounts','GET',undefined,undefined,'unknown')).status).toBe(401);
  const response=await request('/v1/accounts');expect(response.status).toBe(200);expect((await response.json() as {balance:unknown}[])[0].balance).toBe('0');
  const bad=await request('/v1/transactions','POST',{kind:'expense',amount:'1.5',accountId:bank,counterpartAccountId:expense,occurredAt:'2026-10-13T00:00:00Z'});expect(bad.status).toBe(422);
 });
 it('seals validated uploads and scopes deduplication per user',async()=>{
  const data=new Uint8Array([0xff,0xd8,0xff,1,2,3]).buffer;
  const body={fileName:'receipt.jpg',contentType:'image/jpeg',contentHash:await hash(data),sizeBytes:data.byteLength,pageCount:1};
  const created=await request('/v1/uploads','POST',body);expect(created.status).toBe(201);
  const ticket=await created.json() as {id:string;storageKey:string;duplicate:boolean};expect(ticket.duplicate).toBe(false);
  objects.set(`staging/${ticket.storageKey}`,{data,type:'image/jpeg'});
  const complete=await request(`/v1/uploads/${ticket.id}/complete`,'POST',{});expect(complete.status).toBe(202);expect(dispatches).toBeGreaterThan(0);
  expect(objects.has(ticket.storageKey)).toBe(true);expect(objects.has(`staging/${ticket.storageKey}`)).toBe(false);
  const duplicate=await request('/v1/uploads','POST',body);expect((await duplicate.json() as {duplicate:boolean}).duplicate).toBe(true);
  const other=await request('/v1/uploads','POST',body,crypto.randomUUID(),secondUser);expect(other.status).toBe(201);expect((await other.json() as {duplicate:boolean}).duplicate).toBe(false);
  const notOwned=await request(`/v1/documents/${ticket.id}/url`,'GET',undefined,undefined,secondUser);expect(notOwned.status).toBe(404);
 });
 it('concurrent confirmations create exactly one journal and subsequent edits fail',async()=>{
  const doc=(await owner`select id from raw_documents where user_id=${user} limit 1`)[0];
  const x=(await owner`select id from extractions where document_id=${doc.id}`)[0];
  const [draft]=await owner`insert into drafts(user_id,extraction_id,suggested) values(${user},${x.id},${owner.json({kind:'expense',amount:'100000',occurredAt:'2026-10-13T00:00:00Z',counterparty:'test',description:'test',confidence:1})}) returning id`;
  const body={version:1,transaction:{kind:'expense',amount:'100000',accountId:bank,counterpartAccountId:expense,description:'test',occurredAt:'2026-10-13T00:00:00Z'}};
  const key=crypto.randomUUID();const results=await Promise.all([request(`/v1/drafts/${draft.id}/confirm`,'POST',body,key),request(`/v1/drafts/${draft.id}/confirm`,'POST',body,key)]);expect(results.map(r=>r.status)).toEqual([201,201]);
  expect((await owner`select id from journal_entries where draft_id=${draft.id}`).length).toBe(1);
  expect((await request(`/v1/drafts/${draft.id}/confirm`,'POST',body)).status).toBe(409);
  expect((await request(`/v1/drafts/${draft.id}`,'PATCH',body)).status).toBe(409);
 });
});
