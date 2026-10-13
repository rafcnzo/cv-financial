import {Hono} from 'hono';
import {z,ZodError} from 'zod';
import {accountSchema,contactSchema,transactionSchema,uploadSchema} from '@cv/schema';
import {AppError} from '../core/errors';
import type {Env} from '../env';
import {connect,tenant,type Db} from '../adapters/postgres/database';
import {googleLogin,requestOtp,verifyOtp,refresh,verifyAccess,sessionActive,profile} from '../adapters/postgres/auth';
import {idempotent,postTransaction,reverseTransaction} from '../adapters/postgres/transactions';
import {R2Storage} from '../adapters/cloudflare/storage';
import {hash} from '../adapters/crypto';
import {validateFile} from '../adapters/documents';
type Variables={userId:string;sessionId:string;db:Db;authDb:Db};
export const app=new Hono<{Bindings:Env;Variables:Variables}>();
app.onError((err,c)=>{
 if(err instanceof AppError)return c.json({error:{code:err.code,message:err.message}},err.status as 400);
 if(err instanceof ZodError)return c.json({error:{code:'VALIDATION_ERROR',details:err.issues}},422);
 if(err instanceof SyntaxError)return c.json({error:{code:'INVALID_JSON'}},400);
 const dbError=err as {code?:string};
 if(dbError.code==='23514'||dbError.code==='23503')return c.json({error:{code:'LEDGER_CONSTRAINT'}},422);
 if(dbError.code==='23505')return c.json({error:{code:'CONFLICT'}},409);
 console.error(JSON.stringify({event:'request_failed',name:err.name}));
 if(c.env.ENVIRONMENT==='development')console.error(err.stack?.split('\n').slice(1).join('\n'));
 return c.json({error:{code:'INTERNAL_ERROR'}},500);
});
app.get('/health',c=>c.json({status:'ok',version:'0.1.0'}));
app.use('/v1/*',async(c,next)=>{
 const {sql:db}=connect(c.env),{sql:authDb}=connect(c.env,true);c.set('db',db);c.set('authDb',authDb);
 try{await next();}finally{c.executionCtx.waitUntil(Promise.all([db.end(),authDb.end()]));}
});
const email=z.email().max(254),device=z.string().max(100).default('Android');
app.post('/v1/auth/google',async c=>{const body=z.object({idToken:z.string().min(20).max(10000),deviceName:device}).parse(await c.req.json());return c.json(await googleLogin(c.get('authDb'),c.env,body.idToken,body.deviceName));});
app.post('/v1/auth/otp/request',async c=>{const body=z.object({email}).parse(await c.req.json());await requestOtp(c.get('authDb'),c.env,body.email);return c.json({message:'Jika email terdaftar di undangan, kode login dikirim.'});});
app.post('/v1/auth/otp/verify',async c=>{const body=z.object({email,code:z.string().regex(/^\d{6}$/),deviceName:device}).parse(await c.req.json());return c.json(await verifyOtp(c.get('authDb'),c.env,body.email,body.code,body.deviceName));});
app.post('/v1/auth/refresh',async c=>{const body=z.object({refreshToken:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await c.req.json());return c.json(await refresh(c.get('authDb'),c.env,body.refreshToken));});
app.use('/v1/*',async(c,next)=>{
 const token=c.req.header('Authorization')?.replace(/^Bearer /,'');if(!token)throw new AppError('UNAUTHORIZED',401);
 let identity;try{identity=await verifyAccess(c.env,token);}catch{throw new AppError('UNAUTHORIZED',401);}
 if(!await sessionActive(c.get('authDb'),identity.userId,identity.sessionId))throw new AppError('UNAUTHORIZED',401);
 c.set('userId',identity.userId);c.set('sessionId',identity.sessionId);await next();
});
function key(c:{req:{header(name:string):string|undefined}}){return z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/).parse(c.req.header('Idempotency-Key'));}
app.post('/v1/auth/logout',async c=>{await c.get('authDb')`update sessions set revoked_at=now() where id=${c.get('sessionId')} and user_id=${c.get('userId')}`;return c.json({ok:true});});
app.get('/v1/me',async c=>c.json(await profile(c.get('db'),c.get('userId'))));
app.get('/v1/accounts',async c=>c.json(await tenant(c.get('db'),c.get('userId'),async tx=>tx`select a.*,coalesce(sum(l.amount),0)::text balance from accounts a left join journal_lines l on l.account_id=a.id and l.user_id=a.user_id group by a.id order by a.name`)));
app.post('/v1/accounts',async c=>{const body=accountSchema.parse(await c.req.json());if(['receivable','payable'].includes(body.subtype))throw new AppError('USE_CONTACT_ENDPOINT',422);return c.json(await tenant(c.get('db'),c.get('userId'),tx=>idempotent(tx,c.get('userId'),key(c),c.req.path,body,async()=>{const [row]=await tx`insert into accounts(user_id,name,type,subtype) values(${c.get('userId')},${body.name},${body.type},${body.subtype}) returning *`;return row;})),201);});
app.get('/v1/contacts',async c=>c.json(await tenant(c.get('db'),c.get('userId'),async tx=>tx`select c.*,coalesce((select sum(l.amount)::text from journal_lines l join accounts a on a.id=l.account_id where a.contact_id=c.id and a.subtype='receivable'),'0') receivable,coalesce((select (-sum(l.amount))::text from journal_lines l join accounts a on a.id=l.account_id where a.contact_id=c.id and a.subtype='payable'),'0') payable from contacts c order by name`)));
app.post('/v1/contacts',async c=>{const body=contactSchema.parse(await c.req.json());return c.json(await tenant(c.get('db'),c.get('userId'),tx=>idempotent(tx,c.get('userId'),key(c),c.req.path,body,async()=>{const [contact]=await tx`insert into contacts(user_id,name,aliases) values(${c.get('userId')},${body.name},${tx.json(body.aliases)}) returning *`;await tx`insert into accounts(user_id,contact_id,name,type,subtype) values(${c.get('userId')},${contact.id},${'Piutang '+body.name},'asset','receivable'),(${c.get('userId')},${contact.id},${'Utang '+body.name},'liability','payable')`;return contact;})),201);});
app.get('/v1/transactions',async c=>{const limit=z.coerce.number().int().min(1).max(100).parse(c.req.query('limit')??50);const offset=z.coerce.number().int().min(0).max(100000).parse(c.req.query('offset')??0);return c.json(await tenant(c.get('db'),c.get('userId'),async tx=>tx`select e.*,jsonb_agg(jsonb_build_object('accountId',l.account_id,'accountName',a.name,'amount',l.amount::text)) lines from journal_entries e join journal_lines l on l.entry_id=e.id join accounts a on a.id=l.account_id group by e.id order by occurred_at desc,e.id desc limit ${limit} offset ${offset}`));});
app.post('/v1/transactions',async c=>{const body=transactionSchema.parse(await c.req.json());return c.json(await tenant(c.get('db'),c.get('userId'),tx=>idempotent(tx,c.get('userId'),key(c),c.req.path,body,()=>postTransaction(tx,c.get('userId'),body))),201);});
app.post('/v1/transactions/:id/reverse',async c=>{const id=z.uuid().parse(c.req.param('id'));return c.json(await tenant(c.get('db'),c.get('userId'),tx=>idempotent(tx,c.get('userId'),key(c),c.req.path,{},()=>reverseTransaction(tx,c.get('userId'),id))),201);});
app.get('/v1/reports',async c=>{const from=z.iso.datetime({offset:true}).parse(c.req.query('from'));const to=z.iso.datetime({offset:true}).parse(c.req.query('to'));return c.json(await tenant(c.get('db'),c.get('userId'),async tx=>tx`select a.id,a.name,a.type,sum(l.amount)::text amount from journal_lines l join journal_entries e on e.id=l.entry_id join accounts a on a.id=l.account_id where e.occurred_at>=${from} and e.occurred_at<${to} and a.type in ('expense','income') group by a.id,a.name,a.type`));});
app.get('/v1/drafts',async c=>c.json(await tenant(c.get('db'),c.get('userId'),async tx=>tx`select d.*,x.document_id from drafts d join extractions x on x.id=d.extraction_id where d.status='pending' order by d.created_at desc`)));
app.patch('/v1/drafts/:id',async c=>{const id=z.uuid().parse(c.req.param('id'));const {version,transaction}=z.object({version:z.number().int().positive(),transaction:transactionSchema}).parse(await c.req.json());return c.json(await tenant(c.get('db'),c.get('userId'),tx=>idempotent(tx,c.get('userId'),key(c),c.req.path,{version,transaction},async()=>{const [row]=await tx`update drafts set corrected=${tx.json(transaction)},version=version+1 where id=${id} and status='pending' and version=${version} returning *`;if(!row)throw new AppError('DRAFT_CHANGED',409);return row;})));});
app.post('/v1/drafts/:id/confirm',async c=>{const id=z.uuid().parse(c.req.param('id'));const body=z.object({version:z.number().int().positive(),transaction:transactionSchema}).parse(await c.req.json());return c.json(await tenant(c.get('db'),c.get('userId'),tx=>idempotent(tx,c.get('userId'),key(c),c.req.path,body,async()=>{const [draft]=await tx`select * from drafts where id=${id} for update`;if(!draft)throw new AppError('DRAFT_NOT_FOUND',404);if(draft.status!=='pending'||draft.version!==body.version)throw new AppError('DRAFT_CHANGED',409);const entry=await postTransaction(tx,c.get('userId'),body.transaction,id);await tx`update drafts set status='confirmed',corrected=${tx.json(body.transaction)},confirmed_at=now(),version=version+1 where id=${id}`;return entry;})),201);});
app.post('/v1/drafts/:id/ignore',async c=>{const id=z.uuid().parse(c.req.param('id'));return c.json(await tenant(c.get('db'),c.get('userId'),tx=>idempotent(tx,c.get('userId'),key(c),c.req.path,{},async()=>{const [row]=await tx`update drafts set status='ignored',version=version+1 where id=${id} and status='pending' returning id`;if(!row)throw new AppError('DRAFT_CHANGED',409);return {ok:true};})));});
app.get('/v1/documents',async c=>c.json(await tenant(c.get('db'),c.get('userId'),async tx=>tx`select id,source,status,error_code,received_at,retention_until from raw_documents order by received_at desc limit 100`)));
app.post('/v1/uploads',async c=>{
 const body=uploadSchema.parse(await c.req.json());
 const doc=await tenant(c.get('authDb'),c.get('userId'),tx=>idempotent(tx,c.get('userId'),key(c),c.req.path,body,async()=>{
  await tx`select id from resource_limits for update`;
  const [existing]=await tx`select * from raw_documents where user_id=${c.get('userId')} and content_hash=${body.contentHash}`;if(existing)return {id:existing.id,storageKey:existing.storage_key,duplicate:existing.status!=='uploading'};
  const [usage]=await tx`select count(*)::int count from raw_documents where user_id=${c.get('userId')} and received_at>=date_trunc('month',now())`;
  const [user]=await tx`select monthly_ai_quota from users where id=${c.get('userId')}`;
  if(usage.count>=Math.min(user.monthly_ai_quota,Number(c.env.AI_MONTHLY_QUOTA||30)))throw new AppError('MONTHLY_QUOTA_REACHED',429);
  const [storage]=await tx`select reserved_storage_bytes,pg_database_size(current_database())::text db_size from resource_limits`;
  if(BigInt(storage.reserved_storage_bytes)+BigInt(body.sizeBytes)>BigInt(c.env.MAX_STORAGE_BYTES)||BigInt(storage.db_size)>BigInt(c.env.MAX_DB_BYTES))throw new AppError('CAPACITY_LIMIT',503);
  const [cost]=await tx`select coalesce(sum(cost_usd+reserved_usd),0)::text total from extractions where created_at>=date_trunc('month',now())`;
  if(Number(cost.total)>=Number(c.env.AI_MONTHLY_LIMIT_USD))throw new AppError('AI_BUDGET_REACHED',429);
  const id=crypto.randomUUID(),storageKey=`${c.get('userId')}/${id}/original`;
  await tx`insert into raw_documents(id,user_id,source,storage_key,content_hash,content_type,size_bytes,page_count) values(${id},${c.get('userId')},'android',${storageKey},${body.contentHash},${body.contentType},${body.sizeBytes},${body.pageCount})`;
  await tx`update resource_limits set reserved_storage_bytes=reserved_storage_bytes+${body.sizeBytes}`;
  return {id,storageKey,duplicate:false};
 }));
 return c.json({...doc,...(!doc.duplicate?{uploadUrl:await new R2Storage(c.env).putUrl(`staging/${doc.storageKey}`,body.contentType,body.contentHash),headers:{'Content-Type':body.contentType,'x-amz-meta-sha256':body.contentHash}}:{} )},201);
});
app.post('/v1/uploads/:id/complete',async c=>{
 const id=z.uuid().parse(c.req.param('id'));
 const doc=await tenant(c.get('db'),c.get('userId'),async tx=>(await tx`select * from raw_documents where id=${id}`)[0]);if(!doc)throw new AppError('DOCUMENT_NOT_FOUND',404);
 if(doc.status==='uploading'){
  const object=await c.env.DOCUMENTS.get(`staging/${doc.storage_key}`);if(!object||object.size!==Number(doc.size_bytes)||object.httpMetadata?.contentType!==doc.content_type)throw new AppError('UPLOAD_MISMATCH',422);
  // Verify actual bytes, not client metadata; no client can poison another hash record.
  const bytes=await object.arrayBuffer();
  if(await hash(bytes)!==doc.content_hash)throw new AppError('HASH_MISMATCH',422);
  await validateFile(bytes,doc.content_type,doc.page_count);
  // Sealed copy cannot be overwritten by the reusable temporary PUT URL.
  await c.env.DOCUMENTS.put(doc.storage_key,bytes,{httpMetadata:{contentType:doc.content_type}});
  await tenant(c.get('authDb'),c.get('userId'),tx=>idempotent(tx,c.get('userId'),key(c),c.req.path,{},async()=>{
   await tx`select id from resource_limits for update`;
   const [cost]=await tx`select coalesce(sum(cost_usd+reserved_usd),0)::text total from extractions where created_at>=date_trunc('month',now())`;
   const reserve=Number(c.env.AI_RETRIES_USD_RESERVE||0.10)*3;
   if(Number(cost.total)+reserve>Number(c.env.AI_MONTHLY_LIMIT_USD))throw new AppError('AI_BUDGET_REACHED',429);
   await tx`insert into extractions(user_id,document_id,model,prompt_version,reserved_usd) values(${c.get('userId')},${id},${c.env.AI_MODEL},'v1',${reserve}) on conflict(document_id,prompt_version) do nothing`;
   await tx`update raw_documents set status='queued',error_code=null where id=${id} and status='uploading'`;
   return {ok:true};
  }));
  await c.env.DOCUMENTS.delete(`staging/${doc.storage_key}`);
 }
 // Always retry dispatch after a crash between DB commit and Workflow creation.
 try{await c.env.EXTRACTION.create({id,params:{userId:c.get('userId'),documentId:id}});}catch{await c.env.EXTRACTION.get(id);}
 return c.json({id,status:'queued'},202);
});
app.get('/v1/documents/:id/url',async c=>{const id=z.uuid().parse(c.req.param('id'));const doc=await tenant(c.get('db'),c.get('userId'),async tx=>(await tx`select storage_key,status from raw_documents where id=${id}`)[0]);if(!doc||doc.status==='expired')throw new AppError('DOCUMENT_NOT_FOUND',404);return c.json({url:await new R2Storage(c.env).getUrl(doc.storage_key)});});
app.post('/v1/devices',async c=>{const {token}=z.object({token:z.string().min(10).max(1000)}).parse(await c.req.json());await tenant(c.get('db'),c.get('userId'),async tx=>{await tx`insert into device_tokens(user_id,token) values(${c.get('userId')},${token}) on conflict(user_id,token) do update set updated_at=now()`;});return c.json({ok:true});});
