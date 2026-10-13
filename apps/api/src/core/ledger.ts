import type { TransactionInput } from '@cv/schema';
import { AppError } from './errors';
export interface Account {id:string; type:string; subtype:string; is_active:boolean;}
export interface Line {accountId:string; amount:bigint;}
export function buildLines(input:TransactionInput, accounts:Account[]):Line[] {
 const get=(id:string)=>{const a=accounts.find(a=>a.id===id&&a.is_active); if(!a) throw new AppError('ACCOUNT_NOT_FOUND',404); return a;};
 const asset=get(input.accountId);
 if(asset.type!=='asset'||asset.subtype==='receivable') throw new AppError('PAYMENT_ACCOUNT_REQUIRED',422);
 const amount=BigInt(input.amount);
 if(input.kind==='split') {
  const allocations=input.allocations;
  if(!allocations?.length || allocations.reduce((s,a)=>s+BigInt(a.amount),0n)!==amount) throw new AppError('SPLIT_TOTAL_MISMATCH',422);
  const lines=allocations.map(a=>{const account=get(a.accountId); if(account.type!=='expense'&&account.subtype!=='receivable') throw new AppError('INVALID_SPLIT_ACCOUNT',422); return {accountId:a.accountId,amount:BigInt(a.amount)};});
  return [...lines,{accountId:asset.id,amount:-amount}];
 }
 if(!input.counterpartAccountId) throw new AppError('COUNTERPART_REQUIRED',422);
 const other=get(input.counterpartAccountId);
 if(other.id===asset.id) throw new AppError('SAME_ACCOUNT',422);
 const matches:Record<string,boolean>={expense:other.type==='expense',income:other.type==='income',transfer:other.type==='asset'&&other.subtype!=='receivable',advance:other.subtype==='receivable',reimbursement:other.subtype==='receivable',borrow:other.type==='liability',repayment:other.type==='liability',refund:other.type==='expense',opening:other.type==='equity'};
 if(!matches[input.kind]) throw new AppError('INVALID_COUNTERPART',422);
 const out=['expense','transfer','advance','repayment'].includes(input.kind);
 return [{accountId:asset.id,amount:out?-amount:amount},{accountId:other.id,amount:out?amount:-amount}];
}
