import {WorkflowEntrypoint,type WorkflowEvent,type WorkflowStep} from 'cloudflare:workers';
import type {Env,Job} from '../../env';
import {connect,tenant} from '../postgres/database';
import {ClaudeProvider} from '../ai/claude';
import {FcmNotifier} from './fcm';
import {extractionSchema} from '@cv/schema';
export class ExtractionWorkflow extends WorkflowEntrypoint<Env,Job>{
 async run(event:WorkflowEvent<Job>,step:WorkflowStep){
  const {userId,documentId}=event.payload;
  try{
   const document=await step.do('load-document',async()=>{
    const {sql}=connect(this.env);
    try{return await tenant(sql,userId,async tx=>{
     const [doc]=await tx`select * from raw_documents where id=${documentId} and status in ('queued','processing','ready')`;
     if(!doc)throw new Error('DOCUMENT_NOT_READY');
     const [extraction]=await tx`select * from extractions where document_id=${documentId} and prompt_version='v1'`;
     if(!extraction)throw new Error('EXTRACTION_NOT_RESERVED');
     await tx`update raw_documents set status='processing' where id=${documentId} and status<>'ready'`;
     return {storageKey:doc.storage_key as string,contentType:doc.content_type as string,sizeBytes:Number(doc.size_bytes),done:extraction.status==='success',output:extraction.output};
    });}finally{await sql.end();}
   });
   if(document.done)return {alreadyProcessed:true};
   const context=await step.do('load-context',async()=>{
    const {sql}=connect(this.env);try{return await tenant(sql,userId,async tx=>JSON.stringify({contacts:await tx`select name,aliases from contacts limit 30`,rules:await tx`select match_value,transaction from classification_rules limit 20`,openBalances:await tx`select a.name,sum(l.amount)::text balance from accounts a join journal_lines l on l.account_id=a.id where a.subtype in ('receivable','payable') group by a.id having sum(l.amount)<>0 limit 30` }));}finally{await sql.end();}
   });
   const result=await step.do('extract-with-ai',{retries:{limit:2,delay:'10 seconds',backoff:'exponential'},timeout:'2 minutes'},()=>new ClaudeProvider(this.env).extract(document,context));
   const count=await step.do('persist-drafts',async()=>{
    const output=extractionSchema.parse(result.output),{sql}=connect(this.env);
    try{return await tenant(sql,userId,async tx=>{
     const [extraction]=await tx`select * from extractions where document_id=${documentId} and prompt_version='v1' for update`;
     if(extraction.status==='success')return 0;
     const cost=(result.inputTokens*Number(this.env.AI_INPUT_USD_PER_MTOK||0.10)+result.outputTokens*Number(this.env.AI_OUTPUT_USD_PER_MTOK||0.50))/1000000;
     await tx`update extractions set status='success',output=${tx.json(output)},input_tokens=${result.inputTokens},output_tokens=${result.outputTokens},cost_usd=${cost},reserved_usd=greatest(0,reserved_usd-${cost}) where id=${extraction.id}`;
     for(const suggested of output.transactions){
      const occurredAt=suggested.occurredAt;
      const candidates=occurredAt?await tx`select e.id from journal_entries e join journal_lines l on l.entry_id=e.id join accounts a on a.id=l.account_id where e.user_id=${userId} and abs(l.amount)=${suggested.amount} and a.type='asset' and a.subtype<>'receivable' and e.occurred_at between ${occurredAt}::timestamptz-interval '1 day' and ${occurredAt}::timestamptz+interval '1 day' and e.reverses_entry_id is null and not exists(select 1 from journal_entries r where r.reverses_entry_id=e.id) limit 1`:[];
      await tx`insert into drafts(user_id,extraction_id,suggested,possible_duplicate_of) values(${userId},${extraction.id},${tx.json(suggested)},${candidates[0]?.id??null})`;
     }
     await tx`update raw_documents set status='ready',error_code=null where id=${documentId}`;
     return output.transactions.length;
    });}finally{await sql.end();}
   });
   if(count)await step.do('notify-user',{retries:{limit:1,delay:'5 seconds'}},async()=>{
    const {sql}=connect(this.env);try{const tokens=await tenant(sql,userId,async tx=>tx`select token from device_tokens where user_id=${userId} order by updated_at desc limit 10`);await new FcmNotifier(this.env).notify(tokens.map(r=>r.token),count);}finally{await sql.end();}
   });
   return {draftCount:count};
  }catch(error){
   const {sql}=connect(this.env);
   try{await tenant(sql,userId,async tx=>{await tx`update raw_documents set status='failed',error_code='EXTRACTION_FAILED' where id=${documentId} and status<>'ready'`;await tx`update extractions set status='failed' where document_id=${documentId} and status<>'success'`;});}finally{await sql.end();}
   console.error(JSON.stringify({event:'extraction_failed',documentId}));throw error;
  }
 }
}
