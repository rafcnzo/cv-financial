import type {Mailer} from '../../ports/services';
import type {Env} from '../../env';
import {AppError} from '../../core/errors';
export class ResendMailer implements Mailer {
 constructor(private env:Env){}
 async sendOtp(email:string,code:string){
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${this.env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:this.env.RESEND_FROM,to:[email],subject:'Kode login KangCatat',text:`Kode login Anda: ${code}. Berlaku 5 menit. Jangan bagikan kode ini.`})});
  if(!response.ok)throw new AppError('MAIL_UNAVAILABLE',503);
 }
}
