import type { Extraction } from '@cv/schema';
export interface StoredDocument {storageKey:string;contentType:string;sizeBytes:number;}
export interface Storage {putUrl(key:string,contentType:string,hash:string):Promise<string>;getUrl(key:string):Promise<string>;head(key:string):Promise<{size:number;contentType:string}|null>;remove(key:string):Promise<void>;}
export interface ExtractionProvider {extract(document:StoredDocument,context:string):Promise<{output:Extraction;inputTokens:number;outputTokens:number}>;}
export interface Mailer {sendOtp(email:string,code:string):Promise<void>;}
export interface Notifier {notify(tokens:string[],draftCount:number):Promise<void>;}
