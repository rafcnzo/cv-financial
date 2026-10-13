import {describe,it,expect} from 'vitest';
import {PDFDocument} from 'pdf-lib';
import {validateFile} from '../src/adapters/documents';
describe('upload validation',()=>{
 it('rejects disguised files',async()=>{await expect(validateFile(new TextEncoder().encode('not an image').buffer,'image/jpeg',1)).rejects.toThrow('INVALID_JPEG');});
 it('checks PDF page count instead of trusting metadata',async()=>{const pdf=await PDFDocument.create();for(let i=0;i<11;i++)pdf.addPage();const bytes=await pdf.save();await expect(validateFile(bytes.buffer as ArrayBuffer,'application/pdf',1)).rejects.toThrow('INVALID_PDF');});
});
