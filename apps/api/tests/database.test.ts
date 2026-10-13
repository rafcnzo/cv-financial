import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import postgres from 'postgres';
import {tenant} from '../src/adapters/postgres/database';
import {postTransaction,idempotent} from '../src/adapters/postgres/transactions';
import {requestOtp,verifyOtp,refresh} from '../src/adapters/postgres/auth';
import type {Env} from '../src/env';
import {otpHash} from '../src/adapters/crypto';
const url=process.env.TEST_DATABASE_URL;
describe.skipIf(!url)('PostgreSQL ledger and authentication',()=>{
 const owner=postgres(url!,{max:1});
 const runtimeUrl=new URL(url!);runtimeUrl.username='cv_runtime';runtimeUrl.password='local-only';
 const authUrl=new URL(url!);authUrl.username='cv_auth';authUrl.password='local-only';
 const db=postgres(runtimeUrl.toString(),{max:3}),auth=postgres(authUrl.toString(),{max:2});
 const userA=crypto.randomUUID(),userB=crypto.randomUUID();
 const email=`${userA}@example.test`,bank=crypto.randomUUID(),food=crypto.randomUUID(),other=crypto.randomUUID();
 const env={JWT_SECRET:'test-only-secret-more-than-32-characters',OTP_SECRET:'otp-test-only-secret-more-than-32-characters'} as Env;
 beforeAll(async()=>{
  await owner.unsafe("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='cv_runtime') THEN CREATE ROLE cv_runtime LOGIN PASSWORD 'local-only' NOBYPASSRLS; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='cv_auth') THEN CREATE ROLE cv_auth LOGIN PASSWORD 'local-only' NOBYPASSRLS; END IF; END $$");
  await owner.unsafe('GRANT cv_app TO cv_runtime; GRANT cv_system TO cv_auth');
  await owner`insert into users(id,email,display_name) values(${userA},${email},'A'),(${userB},${userB+'@example.test'},'B')`;
  await owner`insert into invitations(email) values(${email})`;
  await owner`insert into accounts(id,user_id,name,type,subtype) values(${bank},${userA},'BCA','asset','bank'),(${food},${userA},'Makan','expense','category'),(${other},${userB},'B bank','asset','bank')`;
 });
 afterAll(async()=>{
  await owner.begin(async tx=>{await tx`select set_config('app.purge_user',${userA},true)`;await tx`delete from journal_lines where user_id=${userA}`;await tx`delete from journal_entries where user_id=${userA}`;await tx`delete from users where id in (${userA},${userB})`;await tx`delete from invitations where email=${email}`;await tx`delete from email_otps where email=${email}`;});
  await Promise.all([owner.end(),db.end(),auth.end()]);
 });
 it('RLS hides B accounts and blocks cross-tenant references',async()=>{
  const rows=await tenant(db,userA,tx=>tx`select * from accounts`);expect(rows.map(r=>r.id)).not.toContain(other);
  await expect(tenant(db,userA,tx=>tx`insert into journal_entries(user_id,entry_type,occurred_at) values(${userB},'expense',now())`)).rejects.toThrow();
  await expect(tenant(db,userA,async tx=>{const [entry]=await tx`insert into journal_entries(user_id,entry_type,occurred_at) values(${userA},'transfer',now()) returning id`;await tx`insert into journal_lines(user_id,entry_id,account_id,amount) values(${userA},${entry.id},${bank},-100),(${userA},${entry.id},${other},100)`;})).rejects.toThrow();
 });
 it('database rejects unbalanced and empty entries',async()=>{
  await expect(tenant(db,userA,tx=>tx`insert into journal_entries(user_id,entry_type,occurred_at) values(${userA},'expense',now())`)).rejects.toThrow('Unbalanced');
  await expect(tenant(db,userA,async tx=>{const [e]=await tx`insert into journal_entries(user_id,entry_type,occurred_at) values(${userA},'expense',now()) returning id`;await tx`insert into journal_lines(user_id,entry_id,account_id,amount) values(${userA},${e.id},${bank},-100),(${userA},${e.id},${food},99)`;})).rejects.toThrow('Unbalanced');
 });
 it('concurrent retry writes one entry and ledger cannot be extended later',async()=>{
  const input={kind:'expense' as const,amount:'100000',accountId:bank,counterpartAccountId:food,description:'test',occurredAt:'2026-10-13T00:00:00Z'};
  const call=()=>tenant(db,userA,tx=>idempotent(tx,userA,'same-retry-key','/v1/transactions',input,()=>postTransaction(tx,userA,input)));
  const [first,second]=await Promise.all([call(),call()]);expect(first.id).toBe(second.id);
  expect((await owner`select * from journal_entries where user_id=${userA}`).length).toBe(1);
  await expect(tenant(db,userA,tx=>tx`insert into journal_lines(user_id,entry_id,account_id,amount) values(${userA},${first.id},${bank},1),(${userA},${first.id},${food},-1)`)).rejects.toThrow('Cannot append');
  await expect(owner`update journal_lines set amount=amount+1 where entry_id=${first.id}`).rejects.toThrow('append-only');
  await expect(tenant(db,userA,tx=>idempotent(tx,userA,'same-retry-key','/v1/transactions',{...input,amount:'1'},()=>postTransaction(tx,userA,input)))).rejects.toThrow('IDEMPOTENCY_CONFLICT');
 });
 it('wrong OTP attempts persist, valid OTP logs in, refresh reuse revokes session',async()=>{
  await owner`insert into email_otps(email,code_hash,expires_at) values(${email},${await otpHash(env.OTP_SECRET,email,'123456')},now()+interval '5 minutes') on conflict(email) do update set code_hash=excluded.code_hash,attempts=0,expires_at=excluded.expires_at`;
  await expect(verifyOtp(auth,env,email,'000000','test')).rejects.toThrow('INVALID_OTP');
  expect((await owner`select attempts from email_otps where email=${email}`)[0].attempts).toBe(1);
  const login=await verifyOtp(auth,env,email,'123456','test');expect(login.userId).toBe(userA);
  const rotated=await refresh(auth,env,login.refreshToken);expect(rotated.refreshToken).not.toBe(login.refreshToken);
  await expect(refresh(auth,env,login.refreshToken)).rejects.toThrow('INVALID_REFRESH_TOKEN');
  await expect(refresh(auth,env,rotated.refreshToken)).rejects.toThrow('INVALID_REFRESH_TOKEN');
 });
});
