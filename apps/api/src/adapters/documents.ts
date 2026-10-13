import {PDFDocument} from 'pdf-lib';
import {AppError} from '../core/errors';
export async function validateFile(bytes:ArrayBuffer,contentType:string,pageCount:number){
 const b=new Uint8Array(bytes);
 if(contentType==='image/jpeg'){if(b[0]!==0xff||b[1]!==0xd8||b[2]!==0xff)throw new AppError('INVALID_JPEG',422);}
 else if(contentType==='image/png'){if([137,80,78,71,13,10,26,10].some((v,i)=>b[i]!==v))throw new AppError('INVALID_PNG',422);}
 else if(contentType==='application/pdf'){
  try{const pdf=await PDFDocument.load(bytes,{updateMetadata:false});if(pdf.getPageCount()>10||pdf.getPageCount()!==pageCount)throw new Error('page limit');}catch{throw new AppError('INVALID_PDF_OR_PAGE_COUNT',422);}
 }else throw new AppError('UNSUPPORTED_DOCUMENT',422);
}
