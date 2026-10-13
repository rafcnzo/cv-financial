import postgres from 'postgres';
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw new Error('Local setup requires localhost DATABASE_URL');
const sql=postgres(url,{max:1});
try {
 await sql.unsafe("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='cv_runtime') THEN CREATE ROLE cv_runtime LOGIN PASSWORD 'local-only' NOBYPASSRLS; END IF; IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='cv_auth') THEN CREATE ROLE cv_auth LOGIN PASSWORD 'local-only' NOBYPASSRLS; END IF; END $$");
 await sql.unsafe('GRANT cv_app TO cv_runtime; GRANT cv_system TO cv_auth');
 console.log('Local runtime roles ready');
}finally{await sql.end();}
