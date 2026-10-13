import {AwsClient} from 'aws4fetch';
import type {Storage} from '../../ports/services';
import type {Env} from '../../env';
export class R2Storage implements Storage {
 constructor(private env:Env){}
 private async sign(key:string,method:string,headers:Record<string,string>={}) {
  const url=new URL(`https://${this.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${this.env.R2_BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`);
  url.searchParams.set('X-Amz-Expires',method==='PUT'?'300':'600');
  const client=new AwsClient({accessKeyId:this.env.R2_ACCESS_KEY_ID,secretAccessKey:this.env.R2_SECRET_ACCESS_KEY,service:'s3',region:'auto'});
  return (await client.sign(url,{method,headers,aws:{signQuery:true,allHeaders:true}})).url;
 }
 putUrl(key:string,contentType:string,hash:string){return this.sign(key,'PUT',{'Content-Type':contentType,'x-amz-meta-sha256':hash});}
 getUrl(key:string){return this.sign(key,'GET');}
 async head(key:string){const o=await this.env.DOCUMENTS.head(key);return o?{size:o.size,contentType:o.httpMetadata?.contentType??''}:null;}
 async remove(key:string){await this.env.DOCUMENTS.delete(key);}
}
