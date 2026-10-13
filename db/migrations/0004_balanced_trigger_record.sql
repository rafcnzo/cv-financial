CREATE OR REPLACE FUNCTION ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid; n bigint; total numeric;
BEGIN
 IF TG_TABLE_NAME='journal_entries' THEN target:=NEW.id; ELSE target:=NEW.entry_id; END IF;
 IF NOT EXISTS(SELECT FROM journal_entries WHERE id=target) THEN RETURN NULL; END IF;
 SELECT count(*),coalesce(sum(amount),0) INTO n,total FROM journal_lines WHERE entry_id=target;
 IF n<2 OR total<>0 THEN RAISE EXCEPTION 'Unbalanced journal entry %',target USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
