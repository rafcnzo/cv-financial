import type {TransactionInput} from '@cv/schema';
import {buildLines,type Account} from '../../core/ledger';
import {AppError} from '../../core/errors';
import {hash} from '../crypto';
import type {Tx} from './database';
export async function idempotent<T>(tx:Tx,userId:string,key:string,route:string,body:unknown,fn:()=>Promise<T>):Promise<T>{
 const requestHash=await hash(JSON.stringify(body));
 await tx`insert into idempotency_keys(user_id,key,route,request_hash) values(${userId},${key},${route},${requestHash}) on conflict do nothing`;
 const [row]=await tx`select * from idempotency_keys where user_id=${userId} and key=${key} for update`;
 if(row.route!==route||row.request_hash!==requestHash)throw new AppError('IDEMPOTENCY_CONFLICT',409);
 if(row.response!==null)return row.response as T;
 const result=await fn();
 await tx`update idempotency_keys set response=${tx.json(result as never)} where user_id=${userId} and key=${key}`;
 return result;
}
export async function postTransaction(tx:Tx,userId:string,input:TransactionInput,draftId?:string){
 const accounts=await tx<Account[]>`select id,type,subtype,is_active from accounts where user_id=${userId}`;
 const lines=buildLines(input,accounts);
 if(input.settlesEntryId){
  if(!['reimbursement','repayment','refund'].includes(input.kind))throw new AppError('INVALID_SETTLEMENT_TYPE',422);
  const [target]=await tx`select e.id from journal_entries e join journal_lines l on l.entry_id=e.id where e.user_id=${userId} and e.id=${input.settlesEntryId} and l.account_id=${input.counterpartAccountId!} and ((${input.kind}='repayment' and l.amount<0) or (${input.kind}<>'repayment' and l.amount>0)) and e.reverses_entry_id is null and not exists(select 1 from journal_entries r where r.reverses_entry_id=e.id)`;
  if(!target)throw new AppError('SETTLEMENT_NOT_FOUND',404);
 }
 const [entry]=await tx`insert into journal_entries(user_id,draft_id,entry_type,occurred_at,description) values(${userId},${draftId??null},${input.kind},${input.occurredAt},${input.description}) returning *`;
 for(const line of lines)await tx`insert into journal_lines(user_id,entry_id,account_id,amount) values(${userId},${entry.id},${line.accountId},${line.amount.toString()})`;
 if(input.settlesEntryId)await tx`insert into entry_links(user_id,from_entry_id,to_entry_id,link_type) values(${userId},${entry.id},${input.settlesEntryId},${input.kind==='refund'?'refund_of':'settles'})`;
 return entry;
}
export async function reverseTransaction(tx:Tx,userId:string,id:string){
 const [original]=await tx`select * from journal_entries where id=${id} and user_id=${userId} for update`;
 if(!original)throw new AppError('TRANSACTION_NOT_FOUND',404);
 if(original.reverses_entry_id || (await tx`select id from journal_entries where reverses_entry_id=${id}`).length)throw new AppError('ALREADY_REVERSED',409);
 const [entry]=await tx`insert into journal_entries(user_id,reverses_entry_id,entry_type,occurred_at,description) values(${userId},${id},'reversal',${original.occurred_at},${`Pembalik: ${original.description}`}) returning *`;
 await tx`insert into journal_lines(user_id,entry_id,account_id,amount) select user_id,${entry.id},account_id,-amount from journal_lines where entry_id=${id} and user_id=${userId}`;
 return entry;
}
