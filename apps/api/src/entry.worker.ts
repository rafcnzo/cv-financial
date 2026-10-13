import {app} from './http/app';
import type {Env} from './env';
import {connect} from './adapters/postgres/database';
export {ExtractionWorkflow} from './adapters/cloudflare/workflow';
async function maintenance(env:Env){
 const {sql}=connect(env,true);
 try{
  const expired=await sql`select id,user_id,storage_key,size_bytes from raw_documents where status<>'expired' and (retention_until<now() or (status='uploading' and received_at<now()-interval '1 day')) limit 100`;
  for(const doc of expired){await env.DOCUMENTS.delete(doc.storage_key);await sql.begin(async tx=>{const changed=await tx`update raw_documents set status='expired' where id=${doc.id} and status<>'expired' returning id`;if(changed.length)await tx`update resource_limits set reserved_storage_bytes=greatest(0,reserved_storage_bytes-${doc.size_bytes})`;});}
  // Recover dispatch after process interruption; Workflow ID is the document UUID.
  const queued=await sql`select id,user_id from raw_documents where status='queued' order by received_at limit 30`;
  for(const doc of queued)try{await env.EXTRACTION.create({id:doc.id,params:{documentId:doc.id,userId:doc.user_id}});}catch{/* Existing workflow is already responsible for it. */}
  // A workflow that died without reaching its catch block must not leave the document in limbo.
  await sql.begin(async tx=>{await tx`update extractions set status='failed' where status<>'success' and document_id in (select id from raw_documents where status='processing' and received_at<now()-interval '6 hours')`;await tx`update raw_documents set status='failed',error_code='EXTRACTION_STALLED' where status='processing' and received_at<now()-interval '6 hours'`;});
  await sql`delete from email_otps where expires_at<now()-interval '1 day'`;
  await sql`delete from sessions where expires_at<now()-interval '30 days'`;
  console.log(JSON.stringify({event:'maintenance',expired:expired.length,queued:queued.length}));
 }finally{await sql.end();}
}
export default {fetch:app.fetch,scheduled(_event:ScheduledController,env:Env,ctx:ExecutionContext){ctx.waitUntil(maintenance(env));}} satisfies ExportedHandler<Env>;
