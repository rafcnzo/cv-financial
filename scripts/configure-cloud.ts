import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const environment=process.argv[2]??'beta';
if(!['beta','development'].includes(environment))throw new Error('Environment must be beta or development');
const file=await readFile('apps/api/.dev.vars','utf8');
const values:Record<string,string>={};
for(const line of file.split(/\r?\n/)){if(line.startsWith('#')||!line.includes('='))continue;const i=line.indexOf('=');values[line.slice(0,i)]=line.slice(i+1).trim();}
const required=['JWT_SECRET','OTP_SECRET','GOOGLE_CLIENT_ID','RESEND_API_KEY','RESEND_FROM','CLAUDE_API_KEY','R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'];
for(const name of required)if(!values[name]||/replace-with|your-|localhost/.test(values[name]))throw new Error(`Configure ${name} in apps/api/.dev.vars first`);
const secrets:Record<string,string>={};
for(const name of [...required,'FCM_PROJECT_ID','FCM_SERVICE_ACCOUNT_EMAIL','FCM_PRIVATE_KEY','AI_INPUT_USD_PER_MTOK','AI_OUTPUT_USD_PER_MTOK','AI_RETRIES_USD_RESERVE'])if(values[name])secrets[name]=values[name];
secrets.R2_BUCKET=environment==='beta'?'cv-financial-beta':'cv-financial-dev';
const args=['wrangler','secret','bulk',...(environment==='beta'?['--env','beta']:[])];
const child=spawn(process.platform==='win32'?'npx.cmd':'npx',args,{cwd:'apps/api',stdio:['pipe','inherit','inherit'],shell:process.platform==='win32'});
child.stdin.end(JSON.stringify(secrets));
await new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Secret upload failed')));});
