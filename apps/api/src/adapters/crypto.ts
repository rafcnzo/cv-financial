export async function hash(value:string|ArrayBuffer):Promise<string> {
 const digest=await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value);
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function randomToken():string {return [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function otpHash(secret:string,email:string,code:string):Promise<string> {
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${email}:${code}`)))].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function constantTimeEqual(a:string,b:string):boolean {let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0;}
