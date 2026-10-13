ALTER TABLE journal_entries ADD COLUMN created_txid xid8 NOT NULL DEFAULT pg_current_xact_id();
CREATE FUNCTION close_entry_lines() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT FROM journal_entries WHERE id=NEW.entry_id AND user_id=NEW.user_id AND created_txid=pg_current_xact_id()) THEN
  RAISE EXCEPTION 'Cannot append lines to a posted journal entry' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER closed_entry_lines BEFORE INSERT ON journal_lines FOR EACH ROW EXECUTE FUNCTION close_entry_lines();
