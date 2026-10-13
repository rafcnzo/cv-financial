import postgres from 'postgres';
import { writeFile } from 'node:fs/promises';
const [command, value] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !value) throw new Error('Set owner DATABASE_URL and supply email (invite) or UUID (export/delete)');
const sql=postgres(process.env.DATABASE_URL,{max:1});
try {
 if(command==='invite') {await sql`insert into invitations(email) values(${value.trim().toLowerCase()}) on conflict(email) do update set revoked_at=null`; console.log('Invitation saved');}
 else {
  if(!/^[0-9a-f-]{36}$/i.test(value)) throw new Error('Expected user UUID');
  const tables=['users','auth_identities','sessions','session_tokens','contacts','accounts','ingest_addresses','raw_documents','extractions','drafts','journal_entries','journal_lines','entry_links','idempotency_keys','device_tokens','classification_rules'];
  if(command==='export') {
   const data:Record<string,unknown>={};
   await sql.begin(async tx=>{await tx`select set_config('app.user_id',${value},true)`; for(const t of tables) {if(t==='session_tokens') continue; data[t]=await tx.unsafe(`select * from ${t} where ${t==='users'?'id':'user_id'}=$1`,[value]);}});
   const path=`${process.env.TEMP ?? '.'}/cv-export-${value}.json`; await writeFile(path,JSON.stringify(data,null,2)); console.log(`Export written to ${path}; contains personal data`);
  } else if(command==='delete') {
   if(process.env.CONFIRM_DELETE_USER!==value) throw new Error('Set CONFIRM_DELETE_USER to the exact UUID');
   // Delete R2 objects separately using the manifest before this operation.
   await sql.begin(async tx=>{await tx`select set_config('app.user_id',${value},true),set_config('app.purge_user',${value},true)`; await tx`delete from entry_links where user_id=${value}`; await tx`update drafts set possible_duplicate_of=null where user_id=${value}`; await tx`delete from journal_lines where user_id=${value}`; await tx`delete from journal_entries where user_id=${value} and reverses_entry_id is not null`; await tx`delete from journal_entries where user_id=${value}`; await tx`delete from drafts where user_id=${value}`; await tx`delete from users where id=${value}`;}); console.log('User deleted');
  } else throw new Error('Unknown command');
 }
} finally {await sql.end();}
