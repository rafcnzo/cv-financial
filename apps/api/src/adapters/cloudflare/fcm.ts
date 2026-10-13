import {SignJWT,importPKCS8} from 'jose';
import type {Notifier} from '../../ports/services';
import type {Env} from '../../env';
export class FcmNotifier implements Notifier {
 constructor(private env:Env){}
 async notify(tokens:string[],draftCount:number){
  if(!tokens.length||!this.env.FCM_PRIVATE_KEY)return;
  const key=await importPKCS8(this.env.FCM_PRIVATE_KEY.replace(/\\n/g,'\n'),'RS256');
  const jwt=await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.messaging'}).setProtectedHeader({alg:'RS256'}).setIssuer(this.env.FCM_SERVICE_ACCOUNT_EMAIL).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(key);
  const auth=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt})});
  if(!auth.ok)throw new Error('FCM_AUTH_FAILED');
  const {access_token}=await auth.json() as {access_token:string};
  for(const token of tokens){const result=await fetch(`https://fcm.googleapis.com/v1/projects/${this.env.FCM_PROJECT_ID}/messages:send`,{method:'POST',headers:{Authorization:`Bearer ${access_token}`,'Content-Type':'application/json'},body:JSON.stringify({message:{token,notification:{title:'Draft siap diperiksa',body:`${draftCount} draft baru di inbox KangCatat`},data:{screen:'inbox'}}})});if(!result.ok)console.warn(JSON.stringify({event:'notification_failed',status:result.status}));}
 }
}
