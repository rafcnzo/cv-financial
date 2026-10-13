import {createRemoteJWKSet,jwtVerify,SignJWT} from 'jose';
import {AppError} from '../../core/errors';
import type {Env} from '../../env';
import type {Db,Tx} from './database';
import {tenant} from './database';
import {constantTimeEqual,hash,otpHash,randomToken} from '../crypto';
import {ResendMailer} from '../mail/resend';
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const normalize=(email:string)=>email.trim().toLowerCase();
function signingKey(env:Env){if(!env.JWT_SECRET||env.JWT_SECRET.length<32)throw new AppError('AUTH_NOT_CONFIGURED',503);return new TextEncoder().encode(env.JWT_SECRET);}
export async function verifyAccess(env:Env,token:string){const {payload}=await jwtVerify(token,signingKey(env),{issuer:'cv-financial',audience:'cv-android',algorithms:['HS256']});if(!payload.sub||typeof payload.sid!=='string')throw new AppError('UNAUTHORIZED',401);return {userId:payload.sub,sessionId:payload.sid};}
async function access(env:Env,userId:string,sessionId:string){return new SignJWT({sid:sessionId}).setProtectedHeader({alg:'HS256'}).setSubject(userId).setIssuer('cv-financial').setAudience('cv-android').setIssuedAt().setExpirationTime('15m').sign(signingKey(env));}
async function provision(tx:Tx,email:string,displayName:string,provider:string,subject:string){
 const [invite]=await tx`select email from invitations where email=${email} and revoked_at is null`;
 if(!invite)throw new AppError('INVITATION_REQUIRED',403);
 let [user]=await tx`select * from users where email=${email} for update`;
 if(!user){const created=await tx`insert into users(email,display_name) values(${email},${displayName}) on conflict(email) do nothing returning *`;
  if(!created.length){[user]=await tx`select * from users where email=${email} for update`;}else{user=created[0];
  await tx`select set_config('app.user_id',${user.id},true)`;
  const defaults=[['Tunai','asset','cash'],['Makan','expense','category'],['Belanja','expense','category'],['Transportasi','expense','category'],['Beban lainnya','expense','category'],['Gaji','income','category'],['Pendapatan lainnya','income','category'],['Saldo awal','equity','opening']];
  for(const [name,type,subtype] of defaults)await tx`insert into accounts(user_id,name,type,subtype) values(${user.id},${name},${type},${subtype})`;
  await tx`insert into ingest_addresses(user_id,local_part,allowed_forwarders) values(${user.id},${`u-${randomToken().slice(0,32)}`},${tx.json([email])})`;
  }
 }
 if(user.status!=='active')throw new AppError('ACCOUNT_SUSPENDED',403);
 await tx`insert into auth_identities(user_id,provider,provider_subject) values(${user.id},${provider},${subject}) on conflict(provider,provider_subject) do nothing`;
 const [identity]=await tx`select user_id from auth_identities where provider=${provider} and provider_subject=${subject}`;
 if(identity.user_id!==user.id)throw new AppError('IDENTITY_CONFLICT',409);
 return user;
}
async function createSession(tx:Tx,env:Env,userId:string,device:string){
 const refreshToken=randomToken();
 const [s]=await tx`insert into sessions(user_id,device_name,expires_at) values(${userId},${device},now()+interval '30 days') returning id`;
 await tx`insert into session_tokens(token_hash,session_id) values(${await hash(refreshToken)},${s.id})`;
 return {accessToken:await access(env,userId,s.id),refreshToken,expiresIn:900,userId};
}
export async function googleLogin(db:Db,env:Env,idToken:string,device:string){
 const {payload}=await jwtVerify(idToken,googleKeys,{audience:env.GOOGLE_CLIENT_ID,issuer:['https://accounts.google.com','accounts.google.com'],algorithms:['RS256']});
 if(typeof payload.email!=='string'||!payload.sub||payload.email_verified!==true)throw new AppError('GOOGLE_EMAIL_UNVERIFIED',401);
 return db.begin(async tx=>{const user=await provision(tx,normalize(payload.email as string),String(payload.name??payload.email),'google',payload.sub!);return createSession(tx,env,user.id,device);});
}
export async function requestOtp(db:Db,env:Env,emailValue:string){
 const email=normalize(emailValue);if(!env.OTP_SECRET||env.OTP_SECRET.length<32)throw new AppError('AUTH_NOT_CONFIGURED',503);
 // Same response for non-invited addresses; do not reveal the allowlist.
 const [invite]=await db`select email from invitations where email=${email} and revoked_at is null`;if(!invite)return;
 // Rejection sampling avoids modulo bias for a six digit code.
 let n:number;do{n=crypto.getRandomValues(new Uint32Array(1))[0];}while(n>=4294000000);
 const code=(n%1000000).toString().padStart(6,'0');
 const rows=await db`insert into email_otps(email,code_hash,expires_at) values(${email},${await otpHash(env.OTP_SECRET,email,code)},now()+interval '5 minutes') on conflict(email) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,last_sent_at=now() where email_otps.last_sent_at<now()-interval '60 seconds' returning email`;
 if(!rows.length)return;
 await new ResendMailer(env).sendOtp(email,code);
}
export async function verifyOtp(db:Db,env:Env,emailValue:string,code:string,device:string){
 const email=normalize(emailValue);
 const result=await db.begin(async tx=>{
  const [row]=await tx`select * from email_otps where email=${email} for update`;
  if(!row||row.attempts>=5||new Date(row.expires_at).getTime()<Date.now())return null;
  await tx`update email_otps set attempts=attempts+1 where email=${email}`;
  if(!constantTimeEqual(row.code_hash,await otpHash(env.OTP_SECRET,email,code)))return null;
  await tx`delete from email_otps where email=${email}`;
  const user=await provision(tx,email,email.split('@')[0],'email_otp',email);
  return createSession(tx,env,user.id,device);
 });
 if(!result)throw new AppError('INVALID_OTP',401);
 return result;
}
export async function refresh(db:Db,env:Env,token:string){
 const result=await db.begin(async tx=>{
  const [row]=await tx`select t.used_at,s.* from session_tokens t join sessions s on s.id=t.session_id join users u on u.id=s.user_id where t.token_hash=${await hash(token)} and u.status='active' for update of s,t`;
  if(!row||row.revoked_at||new Date(row.expires_at).getTime()<Date.now())return null;
  if(row.used_at){await tx`update sessions set revoked_at=now() where id=${row.id}`;return null;}
  const refreshToken=randomToken();
  await tx`update session_tokens set used_at=now() where token_hash=${await hash(token)}`;
  await tx`insert into session_tokens(token_hash,session_id) values(${await hash(refreshToken)},${row.id})`;
  await tx`update sessions set last_used_at=now() where id=${row.id}`;
  return {accessToken:await access(env,row.user_id,row.id),refreshToken,expiresIn:900,userId:row.user_id};
 });
 if(!result)throw new AppError('INVALID_REFRESH_TOKEN',401);return result;
}
export async function sessionActive(db:Db,userId:string,sessionId:string){return (await db`select 1 from sessions s join users u on u.id=s.user_id where s.id=${sessionId} and s.user_id=${userId} and s.revoked_at is null and s.expires_at>now() and u.status='active'`).length>0;}
export async function profile(db:Db,userId:string){return tenant(db,userId,async tx=>(await tx`select id,email,display_name,timezone from users where id=${userId}`)[0]);}
