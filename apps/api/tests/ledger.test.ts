import {describe,it,expect} from 'vitest';
import {buildLines} from '../src/core/ledger';
import {transactionSchema} from '@cv/schema';
const a=(id:string,type:string,subtype:string)=>({id,type,subtype,is_active:true});
const accounts=[a('bank','asset','bank'),a('wallet','asset','ewallet'),a('food','expense','category'),a('budi','asset','receivable'),a('andi','liability','payable'),a('salary','income','category'),a('opening','equity','opening')];
const input=(kind:Parameters<typeof buildLines>[0]['kind'],amount:string,other:string)=>({kind,amount,accountId:'bank',counterpartAccountId:other,occurredAt:'2026-10-13T00:00:00Z',description:''});
describe('ledger templates',()=>{
 it('splits food and Budi then reimburses without income',()=>{
  const purchase=buildLines({...input('split','300000','food'),allocations:[{accountId:'food',amount:'100000'},{accountId:'budi',amount:'200000'}]},accounts);
  const repayment=buildLines(input('reimbursement','200000','budi'),accounts);
  expect(purchase.reduce((s,l)=>s+l.amount,0n)).toBe(0n);
  expect([...purchase,...repayment].filter(l=>l.accountId==='budi').reduce((s,l)=>s+l.amount,0n)).toBe(0n);
  expect([...purchase,...repayment].filter(l=>l.accountId==='bank').reduce((s,l)=>s+l.amount,0n)).toBe(-100000n);
 });
 it.each([['expense','food'],['income','salary'],['transfer','wallet'],['advance','budi'],['borrow','andi'],['repayment','andi'],['refund','food'],['opening','opening']] as const)('balances %s', (kind,other)=>{expect(buildLines(input(kind,'500000',other),accounts).reduce((s,l)=>s+l.amount,0n)).toBe(0n);});
 it('does not treat opening balance as income',()=>{expect(buildLines(input('opening','1000000','opening'),accounts)[1]).toEqual({accountId:'opening',amount:-1000000n});});
 it('rejects mismatched splits and wrong account types',()=>{
  expect(()=>buildLines({...input('split','3','food'),allocations:[{accountId:'food',amount:'2'}]},accounts)).toThrow('SPLIT_TOTAL_MISMATCH');
  expect(()=>buildLines(input('expense','10','salary'),accounts)).toThrow('INVALID_COUNTERPART');
  expect(()=>buildLines(input('transfer','10','bank'),accounts)).toThrow('SAME_ACCOUNT');
 });
 it('rejects floats, numbers and amounts beyond int64',()=>{
  const base={...input('expense','1','food'),accountId:crypto.randomUUID(),counterpartAccountId:crypto.randomUUID()};
  for(const amount of ['1.5','-1','0','9223372036854775808',100])expect(transactionSchema.safeParse({...base,amount}).success).toBe(false);
 });
});
