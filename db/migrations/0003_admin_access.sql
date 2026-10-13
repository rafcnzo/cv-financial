DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['users','contacts','accounts','ingest_addresses','raw_documents','extractions','drafts','journal_entries','journal_lines','entry_links','idempotency_keys','device_tokens','classification_rules'] LOOP
  EXECUTE format('CREATE POLICY admin ON %I TO cv_admin USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
