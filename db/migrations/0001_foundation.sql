CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cv_app') THEN CREATE ROLE cv_app NOLOGIN NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cv_system') THEN CREATE ROLE cv_system NOLOGIN NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cv_admin') THEN CREATE ROLE cv_admin NOLOGIN; END IF;
 EXECUTE format('GRANT cv_admin TO %I',current_user);
END $$;
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, display_name text NOT NULL,
 timezone text NOT NULL DEFAULT 'Asia/Jakarta', status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 monthly_ai_quota int NOT NULL DEFAULT 30 CHECK(monthly_ai_quota>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE invitations(email text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);
CREATE TABLE auth_identities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, provider text NOT NULL CHECK(provider IN ('google','email_otp')), provider_subject text NOT NULL, UNIQUE(provider,provider_subject));
CREATE TABLE sessions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, device_name text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, last_used_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE session_tokens(token_hash text PRIMARY KEY, session_id uuid NOT NULL REFERENCES sessions ON DELETE CASCADE, used_at timestamptz);
CREATE TABLE email_otps(email text PRIMARY KEY, code_hash text NOT NULL, attempts int NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, last_sent_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, name text NOT NULL, aliases jsonb NOT NULL DEFAULT '[]', UNIQUE(id,user_id));
CREATE TABLE accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, contact_id uuid, name text NOT NULL, type text NOT NULL CHECK(type IN ('asset','liability','income','expense','equity')), subtype text NOT NULL CHECK(subtype IN ('bank','ewallet','cash','receivable','payable','category','opening')), is_active boolean NOT NULL DEFAULT true, UNIQUE(id,user_id), FOREIGN KEY(contact_id,user_id) REFERENCES contacts(id,user_id), CHECK((subtype='receivable' AND type='asset' AND contact_id IS NOT NULL) OR (subtype='payable' AND type='liability' AND contact_id IS NOT NULL) OR (subtype IN ('bank','ewallet','cash') AND type='asset' AND contact_id IS NULL) OR (subtype='category' AND type IN ('income','expense') AND contact_id IS NULL) OR (subtype='opening' AND type='equity' AND contact_id IS NULL)));
CREATE UNIQUE INDEX account_contact_kind ON accounts(user_id,contact_id,subtype) WHERE contact_id IS NOT NULL;
CREATE TABLE ingest_addresses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, local_part text NOT NULL UNIQUE, allowed_forwarders jsonb NOT NULL, is_active boolean NOT NULL DEFAULT true, UNIQUE(id,user_id));
CREATE TABLE raw_documents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, ingest_address_id uuid, source text NOT NULL CHECK(source IN ('android','email')), storage_key text NOT NULL, content_hash text NOT NULL, email_message_id text, content_type text NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>0), page_count int NOT NULL CHECK(page_count BETWEEN 1 AND 10), status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','queued','processing','ready','failed','expired')), error_code text, received_at timestamptz NOT NULL DEFAULT now(), retention_until timestamptz NOT NULL DEFAULT now()+interval '1 year', UNIQUE(id,user_id), UNIQUE(user_id,content_hash), FOREIGN KEY(ingest_address_id,user_id) REFERENCES ingest_addresses(id,user_id));
CREATE UNIQUE INDEX document_message_id ON raw_documents(ingest_address_id,email_message_id) WHERE email_message_id IS NOT NULL;
CREATE TABLE extractions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, document_id uuid NOT NULL, model text NOT NULL, prompt_version text NOT NULL, status text NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','success','failed')), output jsonb, input_tokens int NOT NULL DEFAULT 0, output_tokens int NOT NULL DEFAULT 0, cost_usd numeric(14,8) NOT NULL DEFAULT 0, reserved_usd numeric(14,8) NOT NULL DEFAULT 0.1, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id), FOREIGN KEY(document_id,user_id) REFERENCES raw_documents(id,user_id), UNIQUE(document_id,prompt_version));
CREATE TABLE drafts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, extraction_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','ignored')), suggested jsonb NOT NULL, corrected jsonb, possible_duplicate_of uuid, version int NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz, UNIQUE(id,user_id), FOREIGN KEY(extraction_id,user_id) REFERENCES extractions(id,user_id));
CREATE TABLE journal_entries(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, draft_id uuid, reverses_entry_id uuid, entry_type text NOT NULL, occurred_at timestamptz NOT NULL, description text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,user_id), UNIQUE(draft_id), UNIQUE(reverses_entry_id), FOREIGN KEY(draft_id,user_id) REFERENCES drafts(id,user_id), FOREIGN KEY(reverses_entry_id,user_id) REFERENCES journal_entries(id,user_id));
ALTER TABLE drafts ADD CONSTRAINT duplicate_owner FOREIGN KEY(possible_duplicate_of,user_id) REFERENCES journal_entries(id,user_id);
CREATE TABLE journal_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, entry_id uuid NOT NULL, account_id uuid NOT NULL, amount bigint NOT NULL CHECK(amount<>0), memo text NOT NULL DEFAULT '', FOREIGN KEY(entry_id,user_id) REFERENCES journal_entries(id,user_id) ON DELETE CASCADE, FOREIGN KEY(account_id,user_id) REFERENCES accounts(id,user_id));
CREATE INDEX lines_account ON journal_lines(user_id,account_id);
CREATE INDEX lines_entry ON journal_lines(entry_id);
CREATE INDEX entries_history ON journal_entries(user_id,occurred_at DESC,id);
CREATE TABLE entry_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, from_entry_id uuid NOT NULL, to_entry_id uuid NOT NULL, link_type text NOT NULL CHECK(link_type IN ('settles','refund_of')), FOREIGN KEY(from_entry_id,user_id) REFERENCES journal_entries(id,user_id), FOREIGN KEY(to_entry_id,user_id) REFERENCES journal_entries(id,user_id), UNIQUE(from_entry_id,to_entry_id,link_type));
CREATE TABLE idempotency_keys(user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, key text NOT NULL, route text NOT NULL, request_hash text NOT NULL, response jsonb, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,key));
CREATE TABLE device_tokens(user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, token text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,token));
CREATE TABLE classification_rules(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE, match_value text NOT NULL, transaction jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,match_value));
CREATE TABLE resource_limits(id boolean PRIMARY KEY DEFAULT true CHECK(id), reserved_storage_bytes bigint NOT NULL DEFAULT 0);
INSERT INTO resource_limits DEFAULT VALUES;

CREATE FUNCTION ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; n bigint; total numeric;
BEGIN
 target := CASE WHEN TG_TABLE_NAME='journal_entries' THEN NEW.id ELSE NEW.entry_id END;
 IF NOT EXISTS(SELECT FROM journal_entries WHERE id=target) THEN RETURN NULL; END IF;
 SELECT count(*),coalesce(sum(amount),0) INTO n,total FROM journal_lines WHERE entry_id=target;
 IF n<2 OR total<>0 THEN RAISE EXCEPTION 'Unbalanced journal entry %',target USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER entry_balanced AFTER INSERT ON journal_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_balanced();
CREATE CONSTRAINT TRIGGER lines_balanced AFTER INSERT ON journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_balanced();
CREATE FUNCTION ledger_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND pg_has_role(current_user,'cv_admin','member') AND current_setting('app.purge_user',true)=OLD.user_id::text THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Ledger is append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER immutable_entries BEFORE UPDATE OR DELETE ON journal_entries FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER immutable_lines BEFORE UPDATE OR DELETE ON journal_lines FOR EACH ROW EXECUTE FUNCTION ledger_immutable();
CREATE TRIGGER immutable_links BEFORE UPDATE OR DELETE ON entry_links FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['users','contacts','accounts','ingest_addresses','raw_documents','extractions','drafts','journal_entries','journal_lines','entry_links','idempotency_keys','device_tokens','classification_rules'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant ON %I TO cv_app,cv_system USING (%I=current_setting(''app.user_id'',true)::uuid) WITH CHECK (%I=current_setting(''app.user_id'',true)::uuid)',t,CASE WHEN t='users' THEN 'id' ELSE 'user_id' END,CASE WHEN t='users' THEN 'id' ELSE 'user_id' END);
 END LOOP;
END $$;
CREATE POLICY system_users ON users TO cv_system USING(true) WITH CHECK(true);
CREATE POLICY system_documents ON raw_documents TO cv_system USING(true) WITH CHECK(true);
CREATE POLICY system_extractions ON extractions TO cv_system USING(true) WITH CHECK(true);
CREATE POLICY system_ingest ON ingest_addresses TO cv_system USING(true) WITH CHECK(true);
GRANT USAGE ON SCHEMA public TO cv_app,cv_system;
GRANT SELECT ON users TO cv_app;
GRANT SELECT,INSERT,UPDATE ON contacts,accounts,ingest_addresses,raw_documents,extractions,drafts,idempotency_keys,device_tokens,classification_rules TO cv_app;
GRANT DELETE ON device_tokens TO cv_app;
GRANT SELECT,INSERT ON journal_entries,journal_lines,entry_links TO cv_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON users,invitations,auth_identities,sessions,session_tokens,email_otps,raw_documents,extractions,ingest_addresses,resource_limits TO cv_system;
GRANT cv_app TO cv_system;
