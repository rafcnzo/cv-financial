import postgres from 'postgres';
import {execFile as callbackExec} from 'node:child_process';
import {promisify} from 'node:util';
const execFile=promisify(callbackExec);
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Restore check is allowed only on the disposable local Docker database');
const sql=postgres(url,{max:1}),userId=crypto.randomUUID(),bank=crypto.randomUUID(),food=crypto.randomUUID(),entry=crypto.randomUUID();
const dbName=`cv_restore_${crypto.randomUUID().replaceAll('-','')}`,dump=`/tmp/${dbName}.dump`;
const docker=(args:string[])=>execFile('docker',['exec','cv-financial-postgres-1',...args]);
let created=false;
try{
 await sql.begin(async tx=>{await tx`insert into users(id,email,display_name) values(${userId},${userId+'@restore.test'},'Restore test')`;await tx`insert into accounts(id,user_id,name,type,subtype) values(${bank},${userId},'Bank','asset','bank'),(${food},${userId},'Food','expense','category')`;await tx`insert into journal_entries(id,user_id,entry_type,occurred_at) values(${entry},${userId},'expense',now())`;await tx`insert into journal_lines(user_id,entry_id,account_id,amount) values(${userId},${entry},${bank},-100000),(${userId},${entry},${food},100000)`;});
 await docker(['pg_dump','-U','cv_owner','-d','cv_financial','-Fc','--no-owner','--no-acl','-f',dump]);
 await docker(['createdb','-U','cv_owner',dbName]);created=true;
 await docker(['pg_restore','-U','cv_owner','-d',dbName,'--no-owner','--no-acl',dump]);
 const cloneUrl=new URL(url);cloneUrl.pathname=`/${dbName}`;
 const restored=postgres(cloneUrl.toString(),{max:1});
 try{const [balance]=await restored`select sum(amount)::text balance from journal_lines where account_id=${bank}`;if(balance.balance!=='-100000')throw new Error('Restored balance mismatch');console.log('PostgreSQL dump/restore verified with a real balanced entry');}finally{await restored.end();}
}finally{
 if(created)await docker(['dropdb','-U','cv_owner',dbName]);
 await docker(['rm','-f',dump]);
 await sql.begin(async tx=>{await tx`select set_config('app.purge_user',${userId},true)`;await tx`delete from journal_lines where user_id=${userId}`;await tx`delete from journal_entries where user_id=${userId}`;await tx`delete from users where id=${userId}`;});
 await sql.end();
}
