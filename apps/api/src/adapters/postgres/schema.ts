// Typed catalog for tooling. Runtime ledger writes use SQL transactions so that
// deferred constraints, RLS context and row locks remain explicit.
import {pgTable,uuid,text,bigint,timestamp,jsonb,integer} from 'drizzle-orm/pg-core';
export const users=pgTable('users',{id:uuid().primaryKey().defaultRandom(),email:text().notNull().unique(),displayName:text('display_name').notNull(),timezone:text().notNull().default('Asia/Jakarta')});
export const accounts=pgTable('accounts',{id:uuid().primaryKey().defaultRandom(),userId:uuid('user_id').notNull(),name:text().notNull(),type:text().notNull(),subtype:text().notNull()});
export const journalEntries=pgTable('journal_entries',{id:uuid().primaryKey().defaultRandom(),userId:uuid('user_id').notNull(),draftId:uuid('draft_id'),entryType:text('entry_type').notNull(),occurredAt:timestamp('occurred_at',{withTimezone:true}).notNull()});
export const journalLines=pgTable('journal_lines',{id:uuid().primaryKey().defaultRandom(),userId:uuid('user_id').notNull(),entryId:uuid('entry_id').notNull(),accountId:uuid('account_id').notNull(),amount:bigint({mode:'bigint'}).notNull()});
export const drafts=pgTable('drafts',{id:uuid().primaryKey().defaultRandom(),userId:uuid('user_id').notNull(),extractionId:uuid('extraction_id').notNull(),status:text().notNull(),suggested:jsonb().notNull(),corrected:jsonb(),version:integer().notNull().default(1)});
