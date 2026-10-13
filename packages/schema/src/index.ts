import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 10;
export const amountSchema = z.string().regex(/^[1-9]\d*$/).refine(v => /^[1-9]\d*$/.test(v) && v.length <= 19 && BigInt(v) <= 9223372036854775807n, 'Nominal terlalu besar');
export const kindSchema = z.enum(['expense', 'income', 'transfer', 'advance', 'reimbursement', 'borrow', 'repayment', 'refund', 'opening', 'split']);
export const transactionSchema = z.object({
  kind: kindSchema, amount: amountSchema, accountId: z.uuid(),
  counterpartAccountId: z.uuid().optional(),
  allocations: z.array(z.object({ accountId: z.uuid(), amount: amountSchema })).min(1).max(30).optional(),
  occurredAt: z.iso.datetime({offset: true}), description: z.string().trim().max(500).default(''),
  settlesEntryId: z.uuid().optional(),
}).strict();
export type TransactionInput = z.infer<typeof transactionSchema>;
export const accountSchema = z.object({name: z.string().trim().min(1).max(100), type: z.enum(['asset','liability','income','expense','equity']), subtype: z.enum(['bank','ewallet','cash','receivable','payable','category','opening'])}).strict();
export const contactSchema = z.object({name: z.string().trim().min(1).max(100), aliases: z.array(z.string().max(100)).max(20).default([])}).strict();
export const uploadSchema = z.object({fileName: z.string().min(1).max(180), contentType: z.enum(['image/jpeg','image/png','application/pdf']), sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES), contentHash: z.string().regex(/^[a-f0-9]{64}$/), pageCount: z.number().int().min(1).max(MAX_PDF_PAGES).default(1)}).strict();
export const extractionSchema = z.object({
  transactions: z.array(z.object({kind: kindSchema.exclude(['opening','split']), amount: amountSchema, occurredAt: z.iso.datetime({offset:true}).nullable(), counterparty: z.string().max(200), description: z.string().max(500), confidence: z.number().min(0).max(1)}).strict()).max(30),
  warnings: z.array(z.string().max(300)).max(20),
}).strict();
export type Extraction = z.infer<typeof extractionSchema>;
