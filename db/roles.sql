-- Run before restoring a full dump into another PostgreSQL cluster.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cv_app') THEN CREATE ROLE cv_app NOLOGIN NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cv_system') THEN CREATE ROLE cv_system NOLOGIN NOBYPASSRLS; END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='cv_admin') THEN CREATE ROLE cv_admin NOLOGIN; END IF;
 EXECUTE format('GRANT cv_admin TO %I',current_user);
END $$;
